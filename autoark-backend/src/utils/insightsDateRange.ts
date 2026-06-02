import dayjs from 'dayjs'

export const MAX_INSIGHTS_RANGE_DAYS = 90

export type InsightsDateRequest = {
  datePreset: string
  timeRange?: { since: string; until: string }
  startDate?: string
  endDate?: string
}

const parseDate = (value: any): string | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = dayjs(value)
  if (!parsed.isValid()) return undefined
  return parsed.format('YYYY-MM-DD')
}

export const buildInsightsDateRequest = (filters: {
  startDate?: any
  endDate?: any
} = {}): InsightsDateRequest => {
  const requestedStart = parseDate(filters.startDate)
  const requestedEnd = parseDate(filters.endDate)

  if (!requestedStart && !requestedEnd) {
    return { datePreset: 'today' }
  }

  const end = dayjs(requestedEnd || dayjs().format('YYYY-MM-DD'))
  const maxStart = end.subtract(MAX_INSIGHTS_RANGE_DAYS - 1, 'day')
  const requestedStartDate = requestedStart ? dayjs(requestedStart) : maxStart
  const start = requestedStartDate.isAfter(end)
    ? end
    : requestedStartDate.isBefore(maxStart)
      ? maxStart
      : requestedStartDate

  const startDate = start.format('YYYY-MM-DD')
  const endDate = end.format('YYYY-MM-DD')

  return {
    datePreset: '',
    timeRange: { since: startDate, until: endDate },
    startDate,
    endDate,
  }
}
