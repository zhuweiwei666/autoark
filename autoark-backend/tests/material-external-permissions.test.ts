const mockUpdateUser = jest.fn()
const mockWriteAuditLog = jest.fn()

jest.mock('../src/services/user.service', () => ({
  __esModule: true,
  default: {
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

describe('external material permission boundaries', () => {
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

  it('refreshes permissions from the database instead of trusting stale JWT claims', async () => {
    const token = generateToken({
      _id: { toString: () => '665000000000000000000001' },
      username: 'stale-admin',
      email: 'stale@example.com',
      role: UserRole.ORG_ADMIN,
      organizationId: { toString: () => '665000000000000000000099' },
      permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
    } as any)
    expect(verifyToken(token).permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_MANAGE])

    const findById = jest.spyOn(User, 'findById').mockResolvedValue({
      status: UserStatus.ACTIVE,
      permissions: [UserPermission.MATERIALS_EXTERNAL_READ],
    } as any)
    const req: any = { headers: { authorization: `Bearer ${token}` } }
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    }
    const next = jest.fn()

    await authenticate(req, res, next)

    expect(findById).toHaveBeenCalledWith('665000000000000000000001')
    expect(req.user.permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_READ])
    expect(canManageExternalMaterials(req.user)).toBe(false)
    expect(next).toHaveBeenCalledTimes(1)

    findById.mockRestore()
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
