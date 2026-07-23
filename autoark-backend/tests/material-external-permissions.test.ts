const mockCreateUser = jest.fn()
const mockUpdateUser = jest.fn()
const mockWriteAuditLog = jest.fn()

jest.mock('../src/services/user.service', () => ({
  __esModule: true,
  default: {
    createUser: mockCreateUser,
    updateUser: mockUpdateUser,
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: mockWriteAuditLog,
}))

import User, { UserPermission, UserRole, UserStatus } from '../src/models/User'
import { authenticate } from '../src/middlewares/auth'
import userController from '../src/controllers/user.controller'
import { canManageExternalMaterials, canReadExternalMaterials } from '../src/utils/materialPermission'
import { generateToken, verifyToken } from '../src/utils/jwt'
import { sanitizeUserCreateInput, sanitizeUserUpdateInput } from '../src/utils/userInput'

const realUserService = jest.requireActual('../src/services/user.service').default

describe('external material permission boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const superAdmin = {
    role: UserRole.SUPER_ADMIN,
    permissions: [],
  }
  const explicitReader = {
    role: UserRole.ORG_ADMIN,
    permissions: [UserPermission.MATERIALS_EXTERNAL_READ],
  }
  const explicitManager = {
    role: UserRole.MEMBER,
    permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
  }
  const ordinaryOrgAdmin = {
    role: UserRole.ORG_ADMIN,
    permissions: [],
  }
  const member = {
    role: UserRole.MEMBER,
  }

  it('grants super administrators read and manage access', () => {
    expect(canReadExternalMaterials(superAdmin)).toBe(true)
    expect(canManageExternalMaterials(superAdmin)).toBe(true)
  })

  it('grants explicit readers read access but not manage access', () => {
    expect(canReadExternalMaterials(explicitReader)).toBe(true)
    expect(canManageExternalMaterials(explicitReader)).toBe(false)
  })

  it('treats explicit manage access as read access', () => {
    expect(canReadExternalMaterials(explicitManager)).toBe(true)
    expect(canManageExternalMaterials(explicitManager)).toBe(true)
  })

  it('does not grant access based on ordinary organization roles', () => {
    expect(canReadExternalMaterials(ordinaryOrgAdmin)).toBe(false)
    expect(canReadExternalMaterials(member)).toBe(false)
  })

  it('only accepts bounded allowlisted permission arrays from user input', () => {
    expect(sanitizeUserCreateInput({
      permissions: [
        UserPermission.MATERIALS_EXTERNAL_READ,
        UserPermission.MATERIALS_EXTERNAL_MANAGE,
      ],
    }).permissions).toEqual([
      UserPermission.MATERIALS_EXTERNAL_READ,
      UserPermission.MATERIALS_EXTERNAL_MANAGE,
    ])
    expect(sanitizeUserUpdateInput({ permissions: [] })).toEqual({ permissions: [] })

    const unsafeValues = [
      UserPermission.MATERIALS_EXTERNAL_READ,
      { $in: [UserPermission.MATERIALS_EXTERNAL_READ] },
      [UserPermission.MATERIALS_EXTERNAL_READ, 'users:manage'],
      [
        UserPermission.MATERIALS_EXTERNAL_READ,
        UserPermission.MATERIALS_EXTERNAL_MANAGE,
        UserPermission.MATERIALS_EXTERNAL_READ,
      ],
    ]

    for (const permissions of unsafeValues) {
      expect(sanitizeUserUpdateInput({ permissions })).not.toHaveProperty('permissions')
    }
  })

  it('refreshes role, populated organization scope, and permissions before authorization', async () => {
    const userId = '665000000000000000000001'
    const oldOrgId = '665000000000000000000099'
    const newOrgId = '665000000000000000000088'
    const token = generateToken({
      _id: { toString: () => userId },
      username: 'stale-admin',
      email: 'stale@example.com',
      role: UserRole.SUPER_ADMIN,
      organizationId: { toString: () => oldOrgId },
      permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
    } as any)
    expect(verifyToken(token).permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_MANAGE])

    const targetUser = {
      _id: { toString: () => userId },
      username: 'current-member',
      email: 'current@example.com',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      organizationId: { toString: () => newOrgId },
      permissions: [],
      save: jest.fn().mockResolvedValue(undefined),
    }
    const findById = jest.spyOn(User, 'findById')
      .mockResolvedValueOnce({
        ...targetUser,
        organizationId: { _id: { toString: () => newOrgId } },
      } as any)
      .mockResolvedValueOnce(targetUser as any)
    const req: any = { headers: { authorization: `Bearer ${token}` } }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await authenticate(req, res, next)

    expect(findById).toHaveBeenCalledWith(userId)
    expect(req.user).toEqual(expect.objectContaining({
      userId,
      username: 'current-member',
      email: 'current@example.com',
      role: UserRole.MEMBER,
      organizationId: newOrgId,
      permissions: [],
    }))
    expect(canReadExternalMaterials(req.user)).toBe(false)
    expect(canManageExternalMaterials(req.user)).toBe(false)
    expect(next).toHaveBeenCalledTimes(1)

    await realUserService.updateUser(
      userId,
      { permissions: [UserPermission.MATERIALS_EXTERNAL_READ] },
      req.user,
    )
    expect(targetUser.permissions).toEqual([])
    expect(targetUser.save).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unpopulated', { toString: () => '665000000000000000000077' }, '665000000000000000000077'],
    ['detached', undefined, undefined],
  ])('refreshes %s organization scope from the database', async (_case, organizationId, expected) => {
    const token = generateToken({
      _id: { toString: () => '665000000000000000000003' },
      username: 'stale-member',
      email: 'stale-member@example.com',
      role: UserRole.MEMBER,
      organizationId: { toString: () => '665000000000000000000099' },
      permissions: [],
    } as any)
    jest.spyOn(User, 'findById').mockResolvedValue({
      username: 'current-member',
      email: 'current-member@example.com',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      organizationId,
      permissions: [],
    } as any)
    const req: any = { headers: { authorization: `Bearer ${token}` } }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await authenticate(req, res, jest.fn())

    expect(req.user.organizationId).toBe(expected)
  })

  it('includes allowlisted permissions but no credentials in the user create audit snapshot', async () => {
    mockCreateUser.mockResolvedValue({
      _id: '665000000000000000000004',
      username: 'manager',
      email: 'manager@example.com',
      password: 'must-not-be-logged',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
    })
    const req: any = {
      user: {
        userId: '665000000000000000000001',
        role: UserRole.SUPER_ADMIN,
      },
      headers: { authorization: 'Bearer must-not-be-logged' },
      body: {
        username: 'manager',
        email: 'manager@example.com',
        password: 'must-not-be-logged',
        permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
      },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await userController.createUser(req, res)

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE] }),
      req.user,
    )
    const auditDetails = mockWriteAuditLog.mock.calls[0][1]
    expect(auditDetails.after).toEqual({
      username: 'manager',
      email: 'manager@example.com',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
    })
    expect(auditDetails).not.toHaveProperty('password')
    expect(auditDetails).not.toHaveProperty('authorization')
    expect(JSON.stringify(auditDetails)).not.toContain('must-not-be-logged')
  })

  it('includes permissions but never credentials in the user update audit snapshot', async () => {
    mockUpdateUser.mockResolvedValue({
      _id: '665000000000000000000002',
      username: 'reader',
      email: 'reader@example.com',
      password: 'must-not-be-logged',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      permissions: [UserPermission.MATERIALS_EXTERNAL_READ],
    })
    const req: any = {
      user: {
        userId: '665000000000000000000001',
        role: UserRole.SUPER_ADMIN,
      },
      params: { id: '665000000000000000000002' },
      body: { permissions: [UserPermission.MATERIALS_EXTERNAL_READ] },
    }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }

    await userController.updateUser(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1)
    const auditDetails = mockWriteAuditLog.mock.calls[0][1]
    expect(auditDetails.after.permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_READ])
    expect(auditDetails.after).not.toHaveProperty('password')
  })
})
