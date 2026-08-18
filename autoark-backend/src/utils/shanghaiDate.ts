const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

export const formatShanghaiDate = (value: Date | number = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof value === 'number' ? new Date(value) : value)

const parseDateOnly = (date: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Invalid date: ${date}`)
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  )
}

export const addDateDays = (date: string, days: number): string => {
  const parsed = parseDateOnly(date)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export const enumerateDateRange = (
  startDate: string,
  endDate: string,
  limit = Number.POSITIVE_INFINITY,
): string[] => {
  if (startDate > endDate || limit <= 0) return []
  const dates: string[] = []
  let cursor = startDate
  while (cursor <= endDate && dates.length < limit) {
    dates.push(cursor)
    cursor = addDateDays(cursor, 1)
  }
  return dates
}

export const getMutableInsightsDates = (now = new Date()): string[] => {
  const today = formatShanghaiDate(now)
  return [today, addDateDays(today, -1), addDateDays(today, -2)]
}

export const getMutableInsightsWindow = (now = new Date()) => {
  const today = formatShanghaiDate(now)
  return { since: addDateDays(today, -2), until: today }
}

export const getFrozenBeforeDate = (now = new Date()): string =>
  addDateDays(formatShanghaiDate(now), -2)
