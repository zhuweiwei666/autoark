export type ExternalMaterialRuntimeStatus =
  | 'active'
  | 'disabled'
  | 'unavailable'
  | 'paused'

interface ExternalMaterialRuntimeState {
  paused?: boolean
  recurringEnabled?: boolean
}

interface ExternalMaterialRuntimeEnv {
  [key: string]: string | undefined
  EXTERNAL_MATERIAL_SYNC_ENABLED?: string
  GUANGDADA_API_KEY?: string
}

export const resolveExternalMaterialRuntime = (
  state: ExternalMaterialRuntimeState,
  env: ExternalMaterialRuntimeEnv = process.env,
): {
  status: ExternalMaterialRuntimeStatus
  recurringEnabled: boolean
} => {
  if (env.EXTERNAL_MATERIAL_SYNC_ENABLED !== 'true') {
    return { status: 'disabled', recurringEnabled: false }
  }
  if (!env.GUANGDADA_API_KEY?.trim()) {
    return { status: 'unavailable', recurringEnabled: false }
  }
  if (state.paused === true) {
    return { status: 'paused', recurringEnabled: false }
  }
  if (state.recurringEnabled === false) {
    return { status: 'disabled', recurringEnabled: false }
  }
  return { status: 'active', recurringEnabled: true }
}
