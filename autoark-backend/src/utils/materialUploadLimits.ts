export const parsePositiveLimit = (value: any, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export const MAX_MATERIAL_FILE_SIZE = parsePositiveLimit(
  process.env.MATERIAL_MAX_UPLOAD_BYTES,
  100 * 1024 * 1024,
)

export const MAX_DIRECT_UPLOAD_FILES = parsePositiveLimit(
  process.env.MATERIAL_MAX_BATCH_FILES,
  10,
)

export const formatBytes = (value: number): string => {
  if (value < 1024) return `${value}B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)}KB`
  return `${Math.round(value / 1024 / 1024)}MB`
}

export const normalizeFileSize = (size: any): number | null => {
  const value = Number(size)
  return Number.isFinite(value) && value > 0 ? value : null
}

export const validateMaterialFileMeta = (
  input: { fileName?: any; mimeType?: any; size?: any },
  options: { requireSize?: boolean } = {},
): string | null => {
  if (!input.fileName || !input.mimeType) return '请提供文件名和类型'

  const isImage = String(input.mimeType).startsWith('image/')
  const isVideo = String(input.mimeType).startsWith('video/')
  if (!isImage && !isVideo) return '只支持图片和视频文件'

  const fileSize = normalizeFileSize(input.size)
  if (options.requireSize && fileSize === null) return '请提供有效文件大小'
  if (fileSize !== null && fileSize > MAX_MATERIAL_FILE_SIZE) {
    return `文件大小超过限制（最大 ${formatBytes(MAX_MATERIAL_FILE_SIZE)}）`
  }

  return null
}
