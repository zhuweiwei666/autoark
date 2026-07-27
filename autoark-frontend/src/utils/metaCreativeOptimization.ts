export type MetaCreativeOptimizationMode = 'off' | 'auto_crop' | 'advantage_plus'

const META_CREATIVE_OPTIMIZATION_MODES = new Set<MetaCreativeOptimizationMode>([
  'off',
  'auto_crop',
  'advantage_plus',
])

export const getMetaCreativeOptimizationMode = (
  config?: {
    metaCreativeOptimizationMode?: unknown
    metaAutoCrop?: unknown
  } | null,
): MetaCreativeOptimizationMode => {
  const explicitMode = config?.metaCreativeOptimizationMode
  if (
    typeof explicitMode === 'string'
    && META_CREATIVE_OPTIMIZATION_MODES.has(explicitMode as MetaCreativeOptimizationMode)
  ) {
    return explicitMode as MetaCreativeOptimizationMode
  }

  return config?.metaAutoCrop === true ? 'auto_crop' : 'off'
}

export const getMetaCreativeOptimizationLabel = (
  mode: MetaCreativeOptimizationMode,
): string => {
  if (mode === 'advantage_plus') return 'Meta 云端优化'
  if (mode === 'auto_crop') return 'Meta 自动裁剪'
  return '未启用'
}
