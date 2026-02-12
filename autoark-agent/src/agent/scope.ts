/**
 * Agent 权责范围 - 只能操作划定的账户和产品
 * 其他的能看、能分析，但不能操作
 * 配置存在 MongoDB 里，可通过后台界面修改
 */
import mongoose from 'mongoose'
import { log } from '../platform/logger'

export interface AgentScope {
  accountIds: string[]
  packageNames: string[]
  optimizers: string[]
}

const scopeSchema = new mongoose.Schema({
  key: { type: String, default: 'agent_scope', unique: true },
  accountIds: [String],
  packageNames: [String],
  optimizers: [String],
  updatedBy: String,
}, { timestamps: true })

const ScopeModel = mongoose.model('AgentScope', scopeSchema)

let cache: AgentScope = { accountIds: [], packageNames: [], optimizers: [] }

/** 从数据库加载 scope 到内存 */
export async function loadScope(): Promise<AgentScope> {
  try {
    const doc = await ScopeModel.findOne({ key: 'agent_scope' }).lean() as any
    if (doc) {
      cache = {
        accountIds: doc.accountIds || [],
        packageNames: doc.packageNames || [],
        optimizers: doc.optimizers || [],
      }
    }
  } catch (e: any) {
    log.warn('[Scope] Load failed:', e.message)
  }
  return cache
}

export function getScope(): AgentScope { return cache }

/** 保存 scope 到数据库 */
export async function setScope(s: Partial<AgentScope>, updatedBy?: string): Promise<AgentScope> {
  cache = { ...cache, ...s }
  await ScopeModel.findOneAndUpdate(
    { key: 'agent_scope' },
    { ...cache, updatedBy },
    { upsert: true }
  )
  log.info(`[Scope] Updated: accounts=${cache.accountIds.length} packages=${cache.packageNames.length} optimizers=${cache.optimizers.length}`)
  return cache
}

/**
 * 检查某个 campaign 是否在 Agent 可操作范围内
 * 返回 true = 可操作，false = 只能看不能动
 */
export function canOperate(campaign: {
  accountId?: string
  pkgName?: string
  optimizer?: string
}): boolean {
  const s = cache
  // 如果没有配置任何限制，默认全部不可操作（安全第一）
  if (s.accountIds.length === 0 && s.packageNames.length === 0 && s.optimizers.length === 0) {
    return false
  }

  // 账户限制
  if (s.accountIds.length > 0 && campaign.accountId) {
    if (!s.accountIds.includes(campaign.accountId)) return false
  }

  // 包名限制
  if (s.packageNames.length > 0 && campaign.pkgName) {
    if (!s.packageNames.some(pkg => campaign.pkgName!.includes(pkg))) return false
  }

  // 优化师限制
  if (s.optimizers.length > 0 && campaign.optimizer) {
    if (!s.optimizers.includes(campaign.optimizer)) return false
  }

  return true
}

/**
 * 描述当前权责范围（给 LLM 看）
 */
export function describeScopeForPrompt(): string {
  const s = cache
  const parts: string[] = []
  if (s.accountIds.length > 0) parts.push(`可操作账户: ${s.accountIds.join(', ')}`)
  if (s.packageNames.length > 0) parts.push(`可操作产品: ${s.packageNames.join(', ')}`)
  if (s.optimizers.length > 0) parts.push(`可操作优化师: ${s.optimizers.join(', ')}`)
  if (parts.length === 0) return '未配置可操作范围，所有操作需要人工审批。'
  return parts.join('\n') + '\n其他账户/产品只能查看和分析，不能操作。'
}
