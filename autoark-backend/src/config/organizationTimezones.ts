export const DEFAULT_ORGANIZATION_TIMEZONE_OFFSET_MINUTES = 0

export const ORGANIZATION_TIMEZONE_OFFSET_MINUTES = [0, 8 * 60] as const

export const pickOrganizationTimezoneOffsetMinutes = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return ORGANIZATION_TIMEZONE_OFFSET_MINUTES.includes(parsed as 0 | 480)
    ? parsed
    : undefined
}

export const normalizeOrganizationTimezoneOffsetMinutes = (value: unknown): number => (
  pickOrganizationTimezoneOffsetMinutes(value) ?? DEFAULT_ORGANIZATION_TIMEZONE_OFFSET_MINUTES
)

export const formatDateInTimezone = (
  value: Date = new Date(),
  timezoneOffsetMinutes: unknown = DEFAULT_ORGANIZATION_TIMEZONE_OFFSET_MINUTES,
): string => {
  const offset = normalizeOrganizationTimezoneOffsetMinutes(timezoneOffsetMinutes)
  return new Date(value.getTime() + offset * 60_000).toISOString().slice(0, 10)
}
