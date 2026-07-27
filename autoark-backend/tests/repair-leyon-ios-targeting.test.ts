import {
  addIosTargeting,
  assertExpectedRepairScope,
  classifyRepairScope,
  hasOnlyIosTargeting,
  targetingMatchesExceptUserOs,
} from '../src/scripts/repairLeyonIosTargeting'

describe('Leyon iOS targeting repair safeguards', () => {
  test('adds iOS without mutating or dropping existing targeting fields', () => {
    const before = {
      age_min: 18,
      geo_locations: { countries: ['US', 'CA'] },
      targeting_automation: { advantage_audience: 0 },
    }

    const after = addIosTargeting(before)

    expect(after).toEqual({
      ...before,
      user_os: ['iOS'],
    })
    expect(before).not.toHaveProperty('user_os')
    expect(targetingMatchesExceptUserOs(before, after)).toBe(true)
  })

  test('readback comparison ignores array order but rejects unrelated drift', () => {
    const before = {
      geo_locations: { countries: ['US', 'CA'] },
      publisher_platforms: ['facebook', 'instagram'],
    }
    const reorderedWithIos = {
      geo_locations: { countries: ['CA', 'US'] },
      publisher_platforms: ['instagram', 'facebook'],
      user_os: ['iOS'],
    }
    const drifted = {
      ...reorderedWithIos,
      geo_locations: { countries: ['US'] },
    }

    expect(targetingMatchesExceptUserOs(before, reorderedWithIos)).toBe(true)
    expect(targetingMatchesExceptUserOs(before, drifted)).toBe(false)
    expect(hasOnlyIosTargeting(reorderedWithIos)).toBe(true)
    expect(hasOnlyIosTargeting({ user_os: ['iOS_ver_14.0_and_above'] })).toBe(true)
    expect(hasOnlyIosTargeting({ user_os: ['iOS', 'Android'] })).toBe(false)
  })

  test('accepts safe partial progress but requires the exact known final scope', () => {
    const activeMissingIos = Array.from({ length: 15 }, (_, index) => ({
      taskId: `task-${index}`,
      accountId: 'account',
      adsetId: `repair-${index}`,
      found: true,
      status: 'ACTIVE',
      targeting: {},
    }))
    const scope = classifyRepairScope(6, [
      ...activeMissingIos,
      {
        taskId: 'task-ios',
        accountId: 'account',
        adsetId: 'already-ios',
        found: true,
        status: 'ACTIVE',
        targeting: { user_os: ['iOS'] },
      },
      {
        taskId: 'task-versioned-ios',
        accountId: 'account',
        adsetId: 'already-versioned-ios',
        found: true,
        status: 'ACTIVE',
        targeting: { user_os: ['iOS_ver_14.0_and_above'] },
      },
      {
        taskId: 'task-missing-1',
        accountId: 'account',
        adsetId: 'missing-1',
        found: false,
      },
      {
        taskId: 'task-missing-2',
        accountId: 'account',
        adsetId: 'missing-2',
        found: false,
      },
    ])

    expect(() => assertExpectedRepairScope(scope, 17)).not.toThrow()
    expect(() => assertExpectedRepairScope(scope, 16)).toThrow(
      'Leyon repair scope changed; refusing mutation',
    )
  })
})
