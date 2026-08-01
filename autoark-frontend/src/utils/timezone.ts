export const DEFAULT_TIMEZONE_OFFSET_MINUTES = 0

export const normalizeTimezoneOffsetMinutes = (value: unknown): number => (
  value === 8 * 60 ? 8 * 60 : DEFAULT_TIMEZONE_OFFSET_MINUTES
)

export const getDateInTimezone = (
  timezoneOffsetMinutes: unknown,
  value: Date = new Date(),
): string => {
  const offset = normalizeTimezoneOffsetMinutes(timezoneOffsetMinutes)
  return new Date(value.getTime() + offset * 60_000).toISOString().slice(0, 10)
}

export const addDaysToDate = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export const formatTimezoneOffset = (timezoneOffsetMinutes: unknown): string => {
  const offset = normalizeTimezoneOffsetMinutes(timezoneOffsetMinutes)
  return `UTC${offset >= 0 ? '+' : '-'}${Math.abs(offset / 60)}`
}
