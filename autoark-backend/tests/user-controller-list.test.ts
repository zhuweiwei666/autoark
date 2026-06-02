jest.mock('../src/services/user.service', () => ({
  __esModule: true,
  default: {
    getUsers: jest.fn(),
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn(),
}))

import userController from '../src/controllers/user.controller'
import userService from '../src/services/user.service'
import { UserRole, UserStatus } from '../src/models/User'

const mockUserService = userService as jest.Mocked<typeof userService>

describe('user controller list guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('caps user list pagination and ignores unsafe enum filters', async () => {
    mockUserService.getUsers.mockResolvedValue({
      data: [{ _id: '665000000000000000000101', username: 'member' }],
      total: 250,
      page: 3,
      pageSize: 100,
    } as any)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      query: {
        organizationId: ['665000000000000000000001'],
        role: { $ne: UserRole.MEMBER },
        status: { $ne: UserStatus.DISABLED },
        page: '3',
        limit: '9999',
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await userController.getUsers(req, res)

    expect(mockUserService.getUsers).toHaveBeenCalledWith(
      req.user,
      { organizationId: undefined, role: undefined, status: undefined },
      { page: 3, pageSize: 100, skip: 200 },
    )
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: '665000000000000000000101', username: 'member' }],
      total: 250,
      pagination: {
        page: 3,
        pageSize: 100,
        total: 250,
        totalPages: 3,
      },
    })
  })
})
