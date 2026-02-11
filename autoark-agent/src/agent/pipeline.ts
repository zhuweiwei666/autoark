/**
 * 决策流水线 - 每小时自动运行的核心
 * Step 1: 数据采集 (Metabase API)
 * Step 2: 数据加工 (analyzer.ts)
 * Step 3: 分类标记 (classifier.ts)
 * Step 4: LLM 决策 (decision.ts)
 * Step 5: 执行 (auto + 审批)
 * Step 6: 记录快照
 */
import dayjs from 'dayjs'
import axios from 'axios'
import { log } from '../platform/logger'
import { env } from '../config/env'
import { analyzeData } from './analyzer'
import { classifyCampaigns, classifySummary } from './classifier'
import { makeDecisions, DecisionAction } from './decision'
import { Snapshot } from '../data/snapshot.model'
import { Action } from '../action/action.model'
import * as toptouApi from '../platform/toptou/api'
import { getTopTouToken } from '../platform/toptou/client'

const MB_BASE = 'https://meta.iohubonline.club'
const MB_EMAIL = process.env.METABASE_EMAIL || 'zhuweiwei@adcreative.cn'
const MB_PASSWORD = process.env.METABASE_PASSWORD || ''
const MB_CARD_ID = '7786'
const MB_ACCESS_CODE = 'VfuSBdaO33sklvtr'

let mbSession: string | null = null
let mbSessionExpiry = 0

async function getMbSession(): Promise<string> {
  if (mbSession && Date.now() < mbSessionExpiry) return mbSession
  const res = await axios.post(`${MB_BASE}/api/session`, { username: MB_EMAIL, password: MB_PASSWORD })
  mbSession = res.data.id
  mbSessionExpiry = Date.now() + 12 * 3600 * 1000
  return mbSession!
}

/**
 * 运行完整决策流水线
 */
export async function runPipeline(trigger: 'cron' | 'manual' = 'cron'): Promise<any> {
  const startTime = Date.now()
  const today = dayjs().format('YYYY-MM-DD')
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD')
  const dayBefore = dayjs().subtract(2, 'day').format('YYYY-MM-DD')

  log.info(`[Pipeline] Starting (trigger: ${trigger})`)

  // 创建快照记录
  const snapshot = await Snapshot.create({
    runAt: new Date(),
    triggeredBy: trigger,
    status: 'running',
  })

  try {
    // ==================== Step 1: 数据采集 ====================
    log.info('[Pipeline] Step 1: Fetching data from Metabase...')
    const session = await getMbSession()

    // 拉最近 3 天数据
    const mbRes = await axios.post(`${MB_BASE}/api/card/${MB_CARD_ID}/query`, {
      parameters: [
        { type: 'category', value: MB_ACCESS_CODE, target: ['variable', ['template-tag', 'access_code']] },
        { type: 'date/single', value: dayBefore, target: ['variable', ['template-tag', 'start_day']] },
        { type: 'date/single', value: today, target: ['variable', ['template-tag', 'end_day']] },
      ],
    }, {
      headers: { 'X-Metabase-Session': session, 'Content-Type': 'application/json' },
      timeout: 60000,
    })

    const rawData = mbRes.data?.data
    if (!rawData?.cols || !rawData?.rows?.length) {
      throw new Error('Metabase returned no data')
    }

    const columns = rawData.cols.map((c: any) => c.name)
    log.info(`[Pipeline] Step 1 done: ${rawData.rows.length} rows, ${columns.length} columns`)

    // ==================== Step 2: 数据加工 ====================
    log.info('[Pipeline] Step 2: Analyzing data...')
    const campaigns = analyzeData(rawData.rows, columns, today, yesterday, dayBefore)
    log.info(`[Pipeline] Step 2 done: ${campaigns.length} campaigns`)

    // ==================== Step 3: 分类标记 ====================
    log.info('[Pipeline] Step 3: Classifying campaigns...')
    const classified = classifyCampaigns(campaigns)
    const summary = classifySummary(classified)
    log.info(`[Pipeline] Step 3 done: ${JSON.stringify(summary)}`)

    // 更新快照
    const totalSpend = campaigns.reduce((s, c) => s + c.todaySpend, 0)
    const totalRevenue = campaigns.reduce((s, c) => s + c.todayRevenue, 0)

    await Snapshot.updateOne({ _id: snapshot._id }, {
      totalCampaigns: campaigns.length,
      classification: summary,
      totalSpend: Math.round(totalSpend),
      totalRevenue: Math.round(totalRevenue),
      overallRoas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
    })

    // ==================== Step 4: LLM 决策 ====================
    log.info('[Pipeline] Step 4: Making decisions...')
    const decisions = await makeDecisions(classified)
    log.info(`[Pipeline] Step 4 done: ${decisions.actions.length} actions, summary: ${decisions.summary}`)

    // ==================== Step 5: 执行 ====================
    log.info('[Pipeline] Step 5: Executing actions...')
    const executionResults = []

    for (const action of decisions.actions) {
      if (action.auto) {
        // 自动执行
        const result = await executeAction(action)
        executionResults.push({ ...action, executed: true, executedAt: new Date(), executionResult: result })
        log.info(`[Pipeline] Auto-executed: ${action.type} ${action.campaignId} => ${result.success ? 'OK' : result.error}`)
      } else {
        // 进审批队列
        await Action.create({
          type: action.type === 'increase_budget' ? 'adjust_budget' : action.type,
          platform: 'facebook',
          accountId: action.accountId,
          entityId: action.campaignId,
          entityName: action.campaignName,
          params: {
            source: 'pipeline',
            currentBudget: action.currentBudget,
            newBudget: action.newBudget,
            level: 'campaign',
          },
          reason: action.reason,
          status: 'pending',
        })
        executionResults.push({ ...action, executed: false })
        log.info(`[Pipeline] Queued for approval: ${action.type} ${action.campaignName}`)
      }
    }

    // ==================== Step 6: 记录 ====================
    const durationMs = Date.now() - startTime
    await Snapshot.updateOne({ _id: snapshot._id }, {
      actions: executionResults,
      summary: decisions.summary,
      alerts: decisions.alerts,
      durationMs,
      status: 'completed',
    })

    log.info(`[Pipeline] Completed in ${durationMs}ms: ${executionResults.filter(a => a.executed).length} auto-executed, ${executionResults.filter(a => !a.executed).length} pending approval`)

    return {
      snapshotId: snapshot._id.toString(),
      totalCampaigns: campaigns.length,
      classification: summary,
      actions: executionResults,
      summary: decisions.summary,
      alerts: decisions.alerts,
      durationMs,
    }
  } catch (err: any) {
    log.error('[Pipeline] Failed:', err.message)
    await Snapshot.updateOne({ _id: snapshot._id }, {
      status: 'failed',
      error: err.message,
      durationMs: Date.now() - startTime,
    })
    throw err
  }
}

/**
 * 执行单个 auto action（通过 TopTou API）
 */
async function executeAction(action: DecisionAction): Promise<{ success: boolean; error?: string }> {
  if (!getTopTouToken()) {
    return { success: false, error: 'TopTou token not set' }
  }

  try {
    if (action.type === 'pause') {
      const res = await toptouApi.updateStatus({
        level: 'campaign',
        list: [{ id: action.campaignId, accountId: action.accountId, status: 'PAUSED' }],
      })
      return { success: res.code === 200 || res.code === 808 } // 808 = 参数格式待调整
    }

    if (action.type === 'increase_budget' && action.newBudget) {
      const res = await toptouApi.updateNameOrBudget({
        level: 'campaign',
        id: action.campaignId,
        accountId: action.accountId,
        daily_budget: action.newBudget,
      })
      return { success: res.code === 200 }
    }

    return { success: false, error: `Unknown action type: ${action.type}` }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}
