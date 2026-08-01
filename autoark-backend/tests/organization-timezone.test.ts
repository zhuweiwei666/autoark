import {
  formatDateInTimezone,
  normalizeOrganizationTimezoneOffsetMinutes,
  pickOrganizationTimezoneOffsetMinutes,
} from '../src/config/organizationTimezones'

describe('organization timezone', () => {
  it('separates UTC and UTC+8 calendar days at the same instant', () => {
    const instant = new Date('2026-08-01T16:30:00.000Z')

    expect(formatDateInTimezone(instant, 0)).toBe('2026-08-01')
    expect(formatDateInTimezone(instant, 480)).toBe('2026-08-02')
  })

  it('allows only the supported organization offsets and defaults safely to UTC', () => {
    expect(pickOrganizationTimezoneOffsetMinutes('480')).toBe(480)
    expect(pickOrganizationTimezoneOffsetMinutes(0)).toBe(0)
    expect(pickOrganizationTimezoneOffsetMinutes(60)).toBeUndefined()
    expect(normalizeOrganizationTimezoneOffsetMinutes(60)).toBe(0)
  })
})
