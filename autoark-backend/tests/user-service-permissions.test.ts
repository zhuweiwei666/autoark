const mockUserFindById = jest.fn()
const mockCreateUser = jest.fn()
const mockResetPassword = jest.fn()
const mockUpdateUserStatus = jest.fn()

jest.mock('../src/models/User', () => {
  const actual = jest.requireActual('../src/models/User')
  return {
    __esModule: true,
    ...actual,
    default: {
      findById: mockUserFindById,
      findByIdAndDelete: jest.fn(),
      find: jest.fn(),
    },
  }
})

jest.mock('../src/services/auth.service', () => ({
  __esModule: true,
  default: {
    createUser: mockCreateUser,
    resetPassword: mockResetPassword,
    updateUserStatus: mockUpdateUserStatus,
  },
}))

import userService from '../src/services/user.service'
import { UserPermission, UserRole, UserStatus } from '../src/models/User'

const orgId = '665000000000000000000001'
const currentOrgAdmin = {
  userId: '665000000000000000000010',
  role: UserRole.ORG_ADMIN,
  organizationId: orgId,
}

const createUserDoc = (overrides: any = {}) => ({
  _id: { toString: () => overrides.id || '665000000000000000000020' },
  username: 'member',
  email: 'member@example.com',
  role: UserRole.MEMBER,
  status: UserStatus.ACTIVE,
  organizationId: { toString: () => orgId },
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('user service permission boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('defaults organization id when org admins create members', async () => {
    mockCreateUser.mockResolvedValue(createUserDoc())

    await userService.createUser(
      {
        username: 'new-member',
        password: 'secret123',
        email: 'new@example.com',
        role: UserRole.MEMBER,
      },
      currentOrgAdmin as any,
    )

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'new-member',
        role: UserRole.MEMBER,
        organizationId: orgId,
      }),
      currentOrgAdmin.userId,
    )
  })

  it('blocks org admins from creating members in another organization', async () => {
    await expect(
      userService.createUser(
        {
          username: 'other-org-member',
          password: 'secret123',
          email: 'other@example.com',
          role: UserRole.MEMBER,
          organizationId: '665000000000000000000099',
        },
        currentOrgAdmin as any,
      ),
    ).rejects.toThrow('只能在自己的组织内创建用户')

    expect(mockCreateUser).not.toHaveBeenCalled()
  })

  it('strips external material permissions when org admins create members', async () => {
    mockCreateUser.mockResolvedValue(createUserDoc())

    await userService.createUser(
      {
        username: 'permissionless-member',
        password: 'secret123',
        email: 'permissionless@example.com',
        role: UserRole.MEMBER,
        permissions: [UserPermission.MATERIALS_EXTERNAL_MANAGE],
      },
      currentOrgAdmin as any,
    )

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.not.objectContaining({ permissions: expect.anything() }),
      currentOrgAdmin.userId,
    )
  })

  it('allows super administrators to grant external material permissions at creation', async () => {
    const userDoc = createUserDoc({ permissions: [] })
    mockCreateUser.mockResolvedValue(userDoc)

    await userService.createUser(
      {
        username: 'external-reader',
        password: 'secret123',
        email: 'external-reader@example.com',
        role: UserRole.MEMBER,
        organizationId: orgId,
        permissions: [UserPermission.MATERIALS_EXTERNAL_READ],
      },
      {
        userId: '665000000000000000000001',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(userDoc.permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_READ])
    expect(userDoc.save).toHaveBeenCalledTimes(1)
  })

  it('blocks org admins from resetting another admin password', async () => {
    mockUserFindById.mockResolvedValue(createUserDoc({
      username: 'peer-admin',
      role: UserRole.ORG_ADMIN,
    }))

    await expect(
      userService.resetUserPassword('665000000000000000000020', 'new-password', currentOrgAdmin as any),
    ).rejects.toThrow('无权重置管理员用户密码')

    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('blocks org admins from changing another admin status', async () => {
    mockUserFindById.mockResolvedValue(createUserDoc({
      username: 'peer-admin',
      role: UserRole.ORG_ADMIN,
    }))

    await expect(
      userService.updateUserStatus('665000000000000000000020', UserStatus.SUSPENDED, currentOrgAdmin as any),
    ).rejects.toThrow('无权修改管理员用户状态')

    expect(mockUpdateUserStatus).not.toHaveBeenCalled()
  })

  it('strips role organization and status updates from regular members', async () => {
    const userDoc = createUserDoc({
      id: '665000000000000000000030',
      username: 'member',
      email: 'old@example.com',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      organizationId: { toString: () => orgId },
    })
    mockUserFindById.mockResolvedValue(userDoc)

    await userService.updateUser(
      '665000000000000000000030',
      {
        email: 'new@example.com',
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.SUSPENDED,
        organizationId: '665000000000000000000099' as any,
      },
      {
        userId: '665000000000000000000030',
        role: UserRole.MEMBER,
        organizationId: orgId,
      } as any,
    )

    expect(userDoc.email).toBe('new@example.com')
    expect(userDoc.role).toBe(UserRole.MEMBER)
    expect(userDoc.status).toBe(UserStatus.ACTIVE)
    expect(userDoc.organizationId.toString()).toBe(orgId)
    expect(userDoc.save).toHaveBeenCalled()
  })

  it('only allows super administrators to grant external material permissions', async () => {
    const userDoc = createUserDoc({ permissions: [] })
    mockUserFindById.mockResolvedValue(userDoc)

    await userService.updateUser(
      '665000000000000000000020',
      { permissions: [UserPermission.MATERIALS_EXTERNAL_READ] },
      currentOrgAdmin as any,
    )

    expect(userDoc.permissions).toEqual([])

    await userService.updateUser(
      '665000000000000000000020',
      { permissions: [UserPermission.MATERIALS_EXTERNAL_READ] },
      {
        userId: '665000000000000000000001',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(userDoc.permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_READ])
  })

  it('only allows super administrators to revoke external material permissions', async () => {
    const userDoc = createUserDoc({
      id: '665000000000000000000030',
      permissions: [UserPermission.MATERIALS_EXTERNAL_READ],
    })
    mockUserFindById.mockResolvedValue(userDoc)

    await userService.updateUser(
      '665000000000000000000030',
      { permissions: [] },
      {
        userId: '665000000000000000000030',
        role: UserRole.MEMBER,
        organizationId: orgId,
      } as any,
    )

    expect(userDoc.permissions).toEqual([UserPermission.MATERIALS_EXTERNAL_READ])

    await userService.updateUser(
      '665000000000000000000030',
      { permissions: [] },
      {
        userId: '665000000000000000000001',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(userDoc.permissions).toEqual([])
  })

  it('whitelists super admin user updates and drops unsafe fields', async () => {
    const userDoc = createUserDoc({
      id: '665000000000000000000040',
      username: 'old-name',
      email: 'old@example.com',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      organizationId: { toString: () => orgId },
    })
    mockUserFindById.mockResolvedValue(userDoc)

    await userService.updateUser(
      '665000000000000000000040',
      {
        username: ` ${'u'.repeat(70)} `,
        email: '  USER@EXAMPLE.COM  ',
        role: { $ne: UserRole.MEMBER } as any,
        status: 'disabled' as any,
        organizationId: ['665000000000000000000099'] as any,
        password: 'do-not-update',
        boundAppId: 'evil-app',
        createdBy: '665000000000000000000099' as any,
        profile: { unsafe: true } as any,
      },
      {
        userId: '665000000000000000000001',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(userDoc.username).toBe('u'.repeat(50))
    expect(userDoc.email).toBe('user@example.com')
    expect(userDoc.role).toBe(UserRole.MEMBER)
    expect(userDoc.status).toBe(UserStatus.ACTIVE)
    expect(userDoc.organizationId.toString()).toBe(orgId)
    expect((userDoc as any).password).toBeUndefined()
    expect((userDoc as any).boundAppId).toBeUndefined()
    expect((userDoc as any).profile).toBeUndefined()
    expect(userDoc.save).toHaveBeenCalled()
  })
})
