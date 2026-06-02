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
