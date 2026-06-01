import Organization, { OrganizationBillingStatus, OrganizationPlan, OrganizationStatus } from '../src/models/Organization'
import { UserRole } from '../src/models/User'
import organizationService from '../src/services/organization.service'

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
