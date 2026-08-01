jest.mock('../src/utils/jwt', () => ({
  ...jest.requireActual('../src/utils/jwt'),
  verifyToken: jest.fn(),
}))

import User, { UserRole, UserStatus } from '../src/models/User'
import { authenticate } from '../src/middlewares/auth'
import { verifyToken } from '../src/utils/jwt'

describe('authentication organization timezone', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('hydrates the current organization timezone into the request user', async () => {
    ;(verifyToken as jest.Mock).mockReturnValue({ userId: 'user_1' })
    const populate = jest.fn().mockResolvedValue({
      _id: 'user_1',
      username: 'alice',
      email: 'alice@example.com',
      role: UserRole.ORG_ADMIN,
      status: UserStatus.ACTIVE,
      permissions: [],
      organizationId: {
        _id: '665000000000000000000001',
        settings: { timezoneOffsetMinutes: 480 },
      },
    })
    jest.spyOn(User, 'findById').mockReturnValue({ populate } as any)

    const req: any = { headers: { authorization: 'Bearer token' } }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await authenticate(req, res, next)

    expect(populate).toHaveBeenCalledWith({
      path: 'organizationId',
      select: 'settings.timezoneOffsetMinutes',
    })
    expect(req.user).toMatchObject({
      userId: 'user_1',
      organizationId: '665000000000000000000001',
      timezoneOffsetMinutes: 480,
    })
    expect(next).toHaveBeenCalledTimes(1)
  })
})
