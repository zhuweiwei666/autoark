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
