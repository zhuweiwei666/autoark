import {
  addIos16Targeting,
  assertRepairableRecords,
  hasExactIos16Targeting,
} from '../src/scripts/repairLeyonIos16Targeting'
import { targetingMatchesExceptUserOs } from '../src/scripts/repairLeyonIosTargeting'

const buildRecord = (index: number, userOs: string[] = ['iOS']) => ({
  accountId: `account-${index}`,
  adsetId: `adset-${index}`,
  status: 'ACTIVE',
  targeting: {
    geo_locations: { countries: ['US', 'CA'] },
    device_platforms: ['mobile'],
    user_os: userOs,
  },
})

describe('Leyon iOS 16 targeting repair safeguards', () => {
  it('changes only user_os from generic iOS to iOS 16 and above', () => {
    const before = buildRecord(1).targeting
    const after = addIos16Targeting(before)

    expect(after.user_os).toEqual(['iOS_ver_16.0_and_above'])
    expect(hasExactIos16Targeting(after)).toBe(true)
    expect(targetingMatchesExceptUserOs(before, after)).toBe(true)
  })

  it('requires exactly five active generic-or-exact iOS AdSets', () => {
    const records = Array.from({ length: 5 }, (_, index) => buildRecord(index))
    expect(() => assertRepairableRecords(records)).not.toThrow()
    expect(() => assertRepairableRecords(records.slice(1))).toThrow('Expected 5 AdSets')
    expect(() => assertRepairableRecords([
      ...records.slice(0, 4),
      buildRecord(5, ['Android']),
    ])).toThrow('Unexpected AdSet state')
  })
})
