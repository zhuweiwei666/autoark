const mockFindOne = jest.fn()
const mockFindOneAndUpdate = jest.fn()

jest.mock('../src/models/UserSettings', () => ({
  __esModule: true,
  default: {
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  },
}))

import {
  DEFAULT_CAMPAIGN_COLUMNS,
  getCampaignColumnSettings,
  sanitizeCampaignColumns,
  saveCampaignColumnSettings,
} from '../src/services/user.settings.service'

describe('user settings column guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sanitizes custom column keys with bounds and dedupe', () => {
    const columns = sanitizeCampaignColumns([
      ' name ',
      'name',
      'countryName',
      'offsite_conversion.fb_pixel_purchase',
      'bad key with spaces',
      { $ne: 'spend' },
      '',
      'x'.repeat(120),
      ...Array.from({ length: 200 }, (_, index) => `metric_${index}`),
    ])

    expect(columns).toContain('name')
    expect(columns).toContain('countryName')
    expect(columns).toContain('offsite_conversion.fb_pixel_purchase')
    expect(columns).not.toContain('bad key with spaces')
    expect(columns.filter(column => column === 'name')).toHaveLength(1)
    expect(columns.every(column => column.length <= 80)).toBe(true)
    expect(columns).toHaveLength(120)
  })

  it('saves only sanitized campaign columns', async () => {
    mockFindOneAndUpdate.mockImplementation(async (_query, update) => ({
      campaignColumns: update.campaignColumns,
    }))

    const result = await saveCampaignColumnSettings('user_1', [
      ' spend ',
      'spend',
      'mobile_app_install',
      'bad key',
      123,
      'offsite_conversion.fb_pixel_purchase',
    ])

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user_1' },
      {
        campaignColumns: [
          'spend',
          'mobile_app_install',
          'offsite_conversion.fb_pixel_purchase',
        ],
      },
      { upsert: true, new: true },
    )
    expect(result).toEqual([
      'spend',
      'mobile_app_install',
      'offsite_conversion.fb_pixel_purchase',
    ])
  })

  it('sanitizes stored settings and falls back to defaults when none exist', async () => {
    mockFindOne.mockResolvedValueOnce({
      campaignColumns: [' spend ', 'bad key', 'countryName', 'countryName'],
    })
    await expect(getCampaignColumnSettings('user_1')).resolves.toEqual(['spend', 'countryName'])

    mockFindOne.mockResolvedValueOnce(null)
    await expect(getCampaignColumnSettings('user_2')).resolves.toEqual(DEFAULT_CAMPAIGN_COLUMNS)
  })
})
