import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const organizationSource = readSource('../src/pages/OrganizationManagementPage.tsx')
const authSource = readSource('../src/contexts/AuthContext.tsx')
const campaignSource = readSource('../src/pages/FacebookCampaignsPage.tsx')
const countrySource = readSource('../src/pages/FacebookCountriesPage.tsx')

test('organization management saves and displays UTC+0 or UTC+8', () => {
  assert.match(organizationSource, /timezoneOffsetMinutes:\s*editFormData\.timezoneOffsetMinutes/)
  assert.match(organizationSource, /settings:\s*\{ timezoneOffsetMinutes: formData\.timezoneOffsetMinutes \}/)
  assert.match(organizationSource, /\{ value: 0, label: 'UTC\+0' \}/)
  assert.match(organizationSource, /\{ value: 480, label: 'UTC\+8' \}/)
  assert.match(organizationSource, /formatTimezoneOffset\(org\.settings\?\.timezoneOffsetMinutes\)/)
})

test('organization timezone reaches authenticated date defaults', () => {
  assert.match(authSource, /timezoneOffsetMinutes: getUserTimezoneOffsetMinutes\(user\)/)
  assert.match(campaignSource, /getDateInTimezone\(timezoneOffsetMinutes\)/)
  assert.match(countrySource, /getDateInTimezone\(timezoneOffsetMinutes\)/)
  assert.doesNotMatch(campaignSource, /toISOString\(\)\.split\('T'\)\[0\]/)
  assert.doesNotMatch(countrySource, /toISOString\(\)\.split\('T'\)\[0\]/)
})
