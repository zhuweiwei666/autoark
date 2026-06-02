import Organization, { OrganizationBillingStatus, OrganizationPlan, OrganizationStatus } from '../src/models/Organization'
import User from '../src/models/User'
import { UserRole } from '../src/models/User'
import organizationService from '../src/services/organization.service'
import authService from '../src/services/auth.service'

describe('organization service', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('clears quota overrides when settings fields are set to null', async () => {
    const organization: any = {
      _id: '665000000000000000000001',
      name: 'Acme Team',
      status: OrganizationStatus.ACTIVE,
      billing: {
        plan: OrganizationPlan.STARTER,
        status: OrganizationBillingStatus.ACTIVE,
      },
      settings: {
        maxMembers: 12,
        maxAdAccounts: 20,
        monthlyTaskLimit: 500,
      },
      set: jest.fn(function setPath(path: string, value: unknown) {
        const [, key] = path.split('.')
        this.settings[key] = value
      }),
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Organization, 'findById').mockResolvedValue(organization)

    const updated = await organizationService.updateOrganization(
      '665000000000000000000001',
      {
        billing: { plan: OrganizationPlan.GROWTH },
        settings: {
          maxAdAccounts: null,
          monthlyTaskLimit: 3000,
        },
      } as any,
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(organization.set).toHaveBeenCalledWith('settings.maxAdAccounts', undefined)
    expect(organization.set).toHaveBeenCalledWith('settings.monthlyTaskLimit', 3000)
    expect(organization.billing.plan).toBe(OrganizationPlan.GROWTH)
    expect(organization.settings.maxAdAccounts).toBeUndefined()
    expect(organization.settings.monthlyTaskLimit).toBe(3000)
    expect(organization.save).toHaveBeenCalled()
    expect(updated).toBe(organization)
  })

  it('keeps only known commercial feature overrides', async () => {
    const organization: any = {
      _id: '665000000000000000000001',
      name: 'Acme Team',
      status: OrganizationStatus.ACTIVE,
      billing: {
        plan: OrganizationPlan.STARTER,
        status: OrganizationBillingStatus.ACTIVE,
      },
      settings: {
        features: [],
      },
      set: jest.fn(function setPath(path: string, value: unknown) {
        const [, key] = path.split('.')
        this.settings[key] = value
      }),
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Organization, 'findById').mockResolvedValue(organization)

    await organizationService.updateOrganization(
      '665000000000000000000001',
      {
        settings: {
          features: ['bulk_ad_create', 'unknown_feature', ' audit_ready '],
        },
      } as any,
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(organization.set).toHaveBeenCalledWith('settings.features', ['bulk_ad_create', 'audit_ready'])
    expect(organization.settings.features).toEqual(['bulk_ad_create', 'audit_ready'])
    expect(organization.save).toHaveBeenCalled()
  })

  it('bounds commercial billing and quota updates', async () => {
    const organization: any = {
      _id: '665000000000000000000001',
      name: 'Acme Team',
      status: OrganizationStatus.ACTIVE,
      billing: {},
      settings: {},
      set: jest.fn(function setPath(path: string, value: unknown) {
        const [, key] = path.split('.')
        this.settings[key] = value
      }),
      save: jest.fn().mockResolvedValue(undefined),
    }
    jest.spyOn(Organization, 'findById').mockResolvedValue(organization)

    await organizationService.updateOrganization(
      '665000000000000000000001',
      {
        billing: {
          seats: '999999999',
          trialEndsAt: 'not-a-date',
          currentPeriodEndsAt: '2026-07-01T00:00:00.000Z',
          customerId: { $ne: 'cus_1' },
          subscriptionId: ' sub_1 ',
        },
        settings: {
          maxMembers: '-1',
          maxConcurrentTasks: '3.8',
          monthlyTaskLimit: '999999999',
          features: ['bulk_ad_create', 'unknown_feature', 'bulk_ad_create'],
        },
      } as any,
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(organization.billing.seats).toBe(100000)
    expect(organization.billing.trialEndsAt).toBeUndefined()
    expect(organization.billing.currentPeriodEndsAt.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(organization.billing.customerId).toBeUndefined()
    expect(organization.billing.subscriptionId).toBe('sub_1')
    expect(organization.set).not.toHaveBeenCalledWith('settings.maxMembers', expect.anything())
    expect(organization.set).toHaveBeenCalledWith('settings.maxConcurrentTasks', 3)
    expect(organization.set).toHaveBeenCalledWith('settings.monthlyTaskLimit', 10000000)
    expect(organization.set).toHaveBeenCalledWith('settings.features', ['bulk_ad_create'])
  })

  it('sanitizes commercial settings when creating an organization', async () => {
    jest.spyOn(Organization, 'findOne').mockResolvedValue(null as any)
    jest.spyOn(User, 'findOne').mockResolvedValue(null as any)
    const createUserSpy = jest.spyOn(authService, 'createUser').mockResolvedValue({
      _id: '665000000000000000000101',
      toJSON: () => ({ _id: '665000000000000000000101', username: 'org_admin' }),
    } as any)
    jest.spyOn(Organization.prototype, 'save').mockResolvedValue(undefined as any)

    const result = await organizationService.createOrganization(
      {
        name: '  Acme Team  ',
        description: '  Demo org  ',
        adminUsername: '  org_admin  ',
        adminPassword: 'password',
        adminEmail: ' ADMIN@EXAMPLE.COM ',
        settings: {
          maxMembers: '5.8',
          monthlyTaskLimit: '999999999',
          features: ['bulk_ad_create', 'unknown_feature', 'bulk_ad_create'],
        } as any,
      },
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )

    expect(Organization.findOne).toHaveBeenCalledWith({ name: 'Acme Team' })
    expect(User.findOne).toHaveBeenCalledWith({
      $or: [{ username: 'org_admin' }, { email: 'admin@example.com' }],
    })
    expect(createUserSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'org_admin',
        password: 'password',
        email: 'admin@example.com',
        role: UserRole.ORG_ADMIN,
        skipOrgValidation: true,
      }),
      'admin',
    )
    expect(result.organization.name).toBe('Acme Team')
    expect(result.organization.description).toBe('Demo org')
    expect(result.organization.settings).toMatchObject({
      maxMembers: 5,
      monthlyTaskLimit: 10000000,
      features: ['bulk_ad_create'],
    })
  })

  it('rejects unsafe organization admin credentials before user uniqueness checks', async () => {
    const orgFind = jest.spyOn(Organization, 'findOne')
    const userFind = jest.spyOn(User, 'findOne')
    const createUserSpy = jest.spyOn(authService, 'createUser')

    await expect(organizationService.createOrganization(
      {
        name: 'Acme Team',
        adminUsername: { $ne: 'org_admin' } as any,
        adminPassword: 'password',
        adminEmail: 'admin@example.com',
      },
      {
        userId: 'admin',
        role: UserRole.SUPER_ADMIN,
      } as any,
    )).rejects.toThrow('管理员用户名、邮箱不能为空，密码长度需为6-128位')

    expect(orgFind).not.toHaveBeenCalled()
    expect(userFind).not.toHaveBeenCalled()
    expect(createUserSpy).not.toHaveBeenCalled()
  })

  it('rejects organization updates from non super admins', async () => {
    await expect(organizationService.updateOrganization(
      '665000000000000000000001',
      { status: OrganizationStatus.SUSPENDED } as any,
      {
        userId: 'member',
        role: UserRole.MEMBER,
      } as any,
    )).rejects.toThrow('权限不足')
  })
})
