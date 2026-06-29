const toPositiveInt = (value: any, fallback: number): number => {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? Math.floor(next) : fallback
}

export const parsePagination = (
  input: {
    page?: any
    pageSize?: any
    limit?: any
  } = {},
  options: {
    defaultPage?: number
    defaultPageSize?: number
    maxPageSize?: number
  } = {},
) => {
  const defaultPage = options.defaultPage || 1
  const defaultPageSize = options.defaultPageSize || 20
  const maxPageSize = options.maxPageSize || 100

  const page = toPositiveInt(input.page, defaultPage)
  const requestedPageSize = toPositiveInt(input.pageSize ?? input.limit, defaultPageSize)
  const pageSize = Math.min(maxPageSize, requestedPageSize)

  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  }
}

export const parseLimitedNumber = (
  value: any,
  fallback: number,
  max: number,
): number => Math.min(max, toPositiveInt(value, fallback))

export const pickAllowedString = (
  value: any,
  allowedValues: readonly string[],
  fallback: string,
): string => {
  if (typeof value !== 'string') return fallback
  return allowedValues.includes(value) ? value : fallback
}

export const pickSafeQueryString = (
  value: any,
  maxLength = 80,
): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed || undefined
}

export const escapeRegexLiteral = (value: string): string => (
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
)

export const pickSafeRegexLiteral = (
  value: any,
  maxLength = 80,
): string | undefined => {
  const safe = pickSafeQueryString(value, maxLength)
  return safe ? escapeRegexLiteral(safe) : undefined
}
