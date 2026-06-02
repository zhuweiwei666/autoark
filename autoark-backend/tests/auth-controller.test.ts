jest.mock('../src/services/auth.service', () => ({
  __esModule: true,
  default: {
    changePassword: jest.fn(),
    login: jest.fn(),
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn(),
}))

import authController from '../src/controllers/auth.controller'
import authService from '../src/services/auth.service'
import { writeAuditLog } from '../src/services/auditLog.service'
import { UserRole } from '../src/models/User'

const mockAuthService = authService as jest.Mocked<typeof authService>
const mockWriteAuditLog = writeAuditLog as jest.Mock

describe('auth controller audit trail', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('audits authenticated logout requests', async () => {
    const req: any = {
      user: {
        userId: '665000000000000000000901',
        role: UserRole.ORG_ADMIN,
        organizationId: '665000000000000000000001',
      },
      requestId: 'req_logout',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
    }
    mockWriteAuditLog.mockResolvedValue(undefined)

    await authController.logout(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'auth',
      action: 'auth.logout',
      status: 'success',
      userId: req.user.userId,
      organizationId: req.user.organizationId,
      targetType: 'user',
      targetId: req.user.userId,
    }))
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: '登出成功',
    })
  })

  it('rejects unsafe login credentials before calling the service', async () => {
    const req: any = {
      body: {
        username: { $ne: 'admin' },
        password: 'secret123',
      },
      requestId: 'req_login_unsafe',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await authController.login(req, res)

    expect(mockAuthService.login).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '用户名和密码不能为空，密码长度需为6-128位',
    })
  })

  it('sanitizes login credentials before auditing success', async () => {
    const req: any = {
      body: {
        username: '  admin  ',
        password: 'secret123',
      },
      requestId: 'req_login_success',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }
    mockAuthService.login.mockResolvedValue({
      user: {
        _id: '665000000000000000000901',
        username: 'admin',
        email: 'admin@example.com',
        role: UserRole.SUPER_ADMIN,
      },
      token: 'jwt-token',
    } as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    await authController.login(req, res)

    expect(mockAuthService.login).toHaveBeenCalledWith({
      username: 'admin',
      password: 'secret123',
    })
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'auth',
      action: 'auth.login',
      status: 'success',
      username: 'admin',
    }))
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ token: 'jwt-token' }),
    })
  })

  it('rejects unsafe password change input before calling the service', async () => {
    const req: any = {
      user: {
        userId: '665000000000000000000902',
        role: UserRole.MEMBER,
        organizationId: '665000000000000000000001',
      },
      body: {
        oldPassword: { $ne: 'old-password' },
        newPassword: 'a'.repeat(129),
      },
      requestId: 'req_change_password_unsafe',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await authController.changePassword(req, res)

    expect(mockAuthService.changePassword).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '旧密码和新密码长度需为6-128位',
    })
  })

  it('audits failed password changes', async () => {
    const req: any = {
      user: {
        userId: '665000000000000000000902',
        role: UserRole.MEMBER,
        organizationId: '665000000000000000000001',
      },
      body: {
        oldPassword: 'old-password',
        newPassword: 'new-password',
      },
      requestId: 'req_change_password',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }
    mockAuthService.changePassword.mockRejectedValue(new Error('原密码错误'))
    mockWriteAuditLog.mockResolvedValue(undefined)

    await authController.changePassword(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'auth',
      action: 'auth.change_password',
      status: 'failed',
      targetType: 'user',
      targetId: req.user.userId,
      summary: '用户修改密码失败',
      reason: '原密码错误',
    }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '原密码错误',
    })
  })
})
