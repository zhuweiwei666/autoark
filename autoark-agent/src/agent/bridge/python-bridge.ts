import axios from 'axios'
import { log } from '../../platform/logger'

export interface BridgeExperiencePayload {
  traceId: string
  scenario: string
  decision: string
  outcome: 'success' | 'failure' | 'partial'
  lesson: string
  evidence: string[]
  metadata: Record<string, any>
}

export interface RetrievedExperience {
  scenario: string
  lesson: string
  confidence: number
  outcome: string
}

export async function pushExperienceToPython(payload: BridgeExperiencePayload): Promise<boolean> {
  const endpoint = process.env.PYTHON_BRIDGE_ENDPOINT
  if (!endpoint) {
    return false
  }

  try {
    await axios.post(endpoint, payload, {
      timeout: 8000,
      headers: { 'Content-Type': 'application/json' },
    })
    return true
  } catch (err: any) {
    log.warn(`[PythonBridge] push failed: ${err.message}`)
    return false
  }
}

/**
 * 从 Python 向量库检索与当前场景相关的历史经验
 */
export async function fetchExperiencesFromPython(
  query: string,
  topK = 5,
): Promise<RetrievedExperience[]> {
  const endpoint = process.env.PYTHON_BRIDGE_ENDPOINT
  if (!endpoint) return []

  const searchUrl = endpoint.replace(/\/+$/, '').replace(/\/experience$/, '') + '/search'

  try {
    const res = await axios.post(
      searchUrl,
      { query, top_k: topK },
      { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
    )
    const results = res.data?.results || res.data || []
    return results.map((r: any) => ({
      scenario: r.scenario || r.metadata?.scenario || '',
      lesson: r.lesson || r.content || '',
      confidence: r.confidence || r.score || 0.5,
      outcome: r.outcome || r.metadata?.outcome || 'unknown',
    }))
  } catch (err: any) {
    log.debug(`[PythonBridge] search unavailable: ${err.message}`)
    return []
  }
}
