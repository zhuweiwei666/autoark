const mockAccountUpdateOne = jest.fn()

jest.mock('../src/models/Account', () => ({
  __esModule: true,
  default: {
    updateOne: mockAccountUpdateOne,
  },
}))

import {
  isTerminalFacebookAccountAuthError,
  quarantineTerminalFacebookAccount,
} from '../src/services/facebookAccountAuthFailure.service'

describe('Facebook account auth failure quarantine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountUpdateOne.mockResolvedValue({ modifiedCount: 1 })
  })

  it.each([
    'Error validating application. Application has been deleted.',
    'API access blocked.',
    'Error validating access token: Session has expired.',
    'Sessions for the user are not allowed because the user is not a confirmed user.',
  ])('classifies a permanent Meta authorization failure: %s', (message) => {
    expect(isTerminalFacebookAccountAuthError(new Error(message))).toBe(true)
  })

  it('does not quarantine transient rate limits or network failures', async () => {
    expect(isTerminalFacebookAccountAuthError(new Error('RATE_LIMIT: Application request limit reached'))).toBe(false)
    expect(isTerminalFacebookAccountAuthError(new Error('socket hang up'))).toBe(false)

    const changed = await quarantineTerminalFacebookAccount('123', new Error('socket hang up'))

    expect(changed).toBe(false)
    expect(mockAccountUpdateOne).not.toHaveBeenCalled()
  })

  it('marks only the normalized account as requiring reauthorization', async () => {
    const changed = await quarantineTerminalFacebookAccount(
      'act_123',
      new Error('Error validating application. Application has been deleted.'),
    )

    expect(changed).toBe(true)
    expect(mockAccountUpdateOne).toHaveBeenCalledWith(
      { channel: 'facebook', accountId: { $in: ['123', 'act_123'] } },
      { $set: expect.objectContaining({
        status: 'reauth_required',
        syncBlockedAt: expect.any(Date),
        syncBlockedReason: 'Error validating application. Application has been deleted.',
      }) },
    )
  })
})
