jest.mock('../src/services/user.service', () => ({
  __esModule: true,
  default: {
    createUser: jest.fn(),
    getUsers: jest.fn(),
    resetUserPassword: jest.fn(),
    updateUser: jest.fn(),
    updateUserStatus: jest.fn(),
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

  it('sanitizes user creation input before passing it to the service', async () => {
    mockUserService.createUser.mockResolvedValue({
      _id: '665000000000000000000201',
      username: 'new-member',
      email: 'new@example.com',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
    } as any)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      body: {
        username: '  new-member  ',
        password: 'secret123',
        email: '  NEW@EXAMPLE.COM  ',
        role: { $ne: UserRole.MEMBER },
        organizationId: ['665000000000000000000001'],
        status: UserStatus.SUSPENDED,
        boundAppId: 'evil-app',
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await userController.createUser(req, res)

    expect(mockUserService.createUser).toHaveBeenCalledWith(
      {
        username: 'new-member',
        password: 'secret123',
        email: 'new@example.com',
        role: undefined,
        organizationId: undefined,
      },
      req.user,
    )
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('sanitizes user updates and drops non-profile fields', async () => {
    mockUserService.updateUser.mockResolvedValue({
      _id: '665000000000000000000202',
      username: 'new-name',
      email: 'user@example.com',
      role: UserRole.ORG_ADMIN,
      status: UserStatus.SUSPENDED,
      organizationId: '665000000000000000000001',
    } as any)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: {
        id: '665000000000000000000202',
      },
      body: {
        username: '  new-name  ',
        email: '  USER@EXAMPLE.COM  ',
        role: UserRole.ORG_ADMIN,
        status: UserStatus.SUSPENDED,
        organizationId: '665000000000000000000001',
        password: 'do-not-update',
        boundAppId: 'evil-app',
        createdBy: '665000000000000000000099',
        profile: { unsafe: true },
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await userController.updateUser(req, res)

    expect(mockUserService.updateUser).toHaveBeenCalledWith(
      '665000000000000000000202',
      {
        username: 'new-name',
        email: 'user@example.com',
        role: UserRole.ORG_ADMIN,
        status: UserStatus.SUSPENDED,
        organizationId: '665000000000000000000001',
      },
      req.user,
    )
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('rejects oversized reset passwords before calling the service', async () => {
    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: {
        id: '665000000000000000000203',
      },
      body: {
        newPassword: 'a'.repeat(129),
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await userController.resetPassword(req, res)

    expect(mockUserService.resetUserPassword).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '新密码长度需为6-128位',
    })
  })
})
