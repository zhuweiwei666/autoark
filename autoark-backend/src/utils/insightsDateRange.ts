import dayjs from 'dayjs'

export const MAX_INSIGHTS_RANGE_DAYS = 90
const INSIGHTS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export class InsightsDateRangeError extends Error {
  statusCode = 400
}

export type InsightsDateRequest = {
  datePreset: string
  timeRange?: { since: string; until: string }
  startDate?: string
  endDate?: string
}

const parseDate = (value: any, fieldName: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InsightsDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }
  if (!INSIGHTS_DATE_PATTERN.test(value)) {
    throw new InsightsDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }

  const parsed = dayjs(value)
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new InsightsDateRangeError(`${fieldName} must be a valid YYYY-MM-DD date`)
  }

  return parsed.format('YYYY-MM-DD')
}

export const buildInsightsDateRequest = (filters: {
  startDate?: any
  endDate?: any
} = {}): InsightsDateRequest => {
  const requestedStart = parseDate(filters.startDate, 'startDate')
  const requestedEnd = parseDate(filters.endDate, 'endDate')

  if (!requestedStart && !requestedEnd) {
    return { datePreset: 'today' }
  }

  const end = dayjs(requestedEnd || dayjs().format('YYYY-MM-DD'))
  const maxStart = end.subtract(MAX_INSIGHTS_RANGE_DAYS - 1, 'day')
  const requestedStartDate = requestedStart ? dayjs(requestedStart) : maxStart
  if (requestedStartDate.isAfter(end)) {
    throw new InsightsDateRangeError('startDate must be earlier than or equal to endDate')
  }

  const start = requestedStartDate.isBefore(maxStart)
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
