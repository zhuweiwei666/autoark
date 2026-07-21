const mockAccountExists = jest.fn()

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    exists: mockAccountExists,
  },
}))

import { canProcessFacebookOriginalImageJob } from '../src/services/facebookMaterialEligibility.service'

describe('Facebook original image job eligibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('allows an active account with a token', async () => {
    mockAccountExists.mockResolvedValue({ _id: 'account-1' })

    await expect(canProcessFacebookOriginalImageJob('act_123')).resolves.toBe(true)
    expect(mockAccountExists).toHaveBeenCalledWith({
      channel: 'facebook',
      status: 'active',
      accountId: { $in: ['123', 'act_123'] },
      token: { $exists: true, $nin: [null, ''] },
    })
  })

  it('rejects a quarantined or tokenless account', async () => {
    mockAccountExists.mockResolvedValue(null)

    await expect(canProcessFacebookOriginalImageJob('123')).resolves.toBe(false)
  })
})
