/**
 * Metabase API 代理 - 后端拿数据，前端渲染
 */
import { Router, Request, Response } from 'express'
import axios from 'axios'
import { authenticate } from '../auth/auth.middleware'
import { log } from '../platform/logger'

const router = Router()
router.use(authenticate)

const MB_BASE = 'https://meta.iohubonline.club'
const MB_EMAIL = process.env.METABASE_EMAIL || 'zhuweiwei@adcreative.cn'
const MB_PASSWORD = process.env.METABASE_PASSWORD || 'QTL8GX92DmN29d'

let sessionToken: string | null = null
let sessionExpiry = 0

async function getSession(): Promise<string> {
  if (sessionToken && Date.now() < sessionExpiry) return sessionToken
  const res = await axios.post(`${MB_BASE}/api/session`, {
    username: MB_EMAIL, password: MB_PASSWORD,
  })
  sessionToken = res.data.id
  sessionExpiry = Date.now() + 12 * 3600 * 1000 // 12 hours
  log.info('[Metabase] Session acquired')
  return sessionToken!
}

// 查询指定 question
router.get('/query/:cardId', async (req: Request, res: Response) => {
  try {
    const token = await getSession()
    const { cardId } = req.params
    const { start_day, end_day, access_code, optimizer, pkg_name, cam_id, platform, channel_name, user_name } = req.query

    // 构造参数
    const parameters: any[] = []
    if (access_code) parameters.push({ type: 'category', value: access_code, target: ['variable', ['template-tag', 'access_code']] })
    if (start_day) parameters.push({ type: 'date/single', value: start_day, target: ['variable', ['template-tag', 'start_day']] })
    if (end_day) parameters.push({ type: 'date/single', value: end_day, target: ['variable', ['template-tag', 'end_day']] })
    if (user_name) parameters.push({ type: 'category', value: user_name, target: ['variable', ['template-tag', 'user_name']] })
    if (optimizer) parameters.push({ type: 'category', value: optimizer, target: ['variable', ['template-tag', 'optimizer']] })
    if (pkg_name) parameters.push({ type: 'category', value: pkg_name, target: ['variable', ['template-tag', 'pkg_name']] })
    if (cam_id) parameters.push({ type: 'category', value: cam_id, target: ['variable', ['template-tag', 'cam_id']] })
    if (platform) parameters.push({ type: 'category', value: platform, target: ['variable', ['template-tag', 'platform']] })
    if (channel_name) parameters.push({ type: 'category', value: channel_name, target: ['variable', ['template-tag', 'channel_name']] })

    const mbRes = await axios.post(`${MB_BASE}/api/card/${cardId}/query`, { parameters }, {
      headers: { 'X-Metabase-Session': token, 'Content-Type': 'application/json' },
      timeout: 60000,
    })

    const data = mbRes.data?.data
    if (!data) return res.json({ columns: [], rows: [], total: 0 })

    const columns = (data.cols || []).map((c: any) => ({
      name: c.name,
      displayName: c.display_name,
      type: c.base_type,
    }))

    res.json({
      columns,
      rows: data.rows || [],
      total: data.rows?.length || 0,
    })
  } catch (err: any) {
    log.error('[Metabase] Query failed:', err.response?.data || err.message)
    if (err.response?.status === 401) {
      sessionToken = null // 清掉过期 session
      return res.status(401).json({ error: 'Metabase session expired, retry' })
    }
    res.status(500).json({ error: err.message })
  }
})

export default router
