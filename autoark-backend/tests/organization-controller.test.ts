jest.mock('../src/services/organization.service', () => ({
  __esModule: true,
  default: {
    getOrganizationById: jest.fn(),
    updateOrganization: jest.fn(),
  },
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn(),
}))

import organizationController from '../src/controllers/organization.controller'
import organizationService from '../src/services/organization.service'
import { writeAuditLog } from '../src/services/auditLog.service'
import { OrganizationBillingStatus, OrganizationPlan, OrganizationStatus } from '../src/models/Organization'
import { UserRole } from '../src/models/User'

const mockOrganizationService = organizationService as jest.Mocked<typeof organizationService>
const mockWriteAuditLog = writeAuditLog as jest.Mock

describe('organization controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('audits before and after snapshots when updating commercial plan limits', async () => {
    const beforeOrganization = {
      _id: '665000000000000000000001',
      name: 'Acme Team',
      status: OrganizationStatus.ACTIVE,
      billing: {
        plan: OrganizationPlan.STARTER,
        status: OrganizationBillingStatus.ACTIVE,
      },
      settings: {
        maxAdAccounts: 15,
        monthlyTaskLimit: 300,
      },
    }
    const afterOrganization = {
      ...beforeOrganization,
      billing: {
        plan: OrganizationPlan.GROWTH,
        status: OrganizationBillingStatus.ACTIVE,
      },
      settings: {
        monthlyTaskLimit: 3000,
      },
    }

    mockOrganizationService.getOrganizationById.mockResolvedValue(beforeOrganization as any)
    mockOrganizationService.updateOrganization.mockResolvedValue(afterOrganization as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: { id: '665000000000000000000001' },
      body: {
        billing: { plan: OrganizationPlan.GROWTH },
        settings: { maxAdAccounts: null, monthlyTaskLimit: 3000 },
      },
      requestId: 'req_org_update',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await organizationController.updateOrganization(req, res)

    expect(mockOrganizationService.getOrganizationById).toHaveBeenCalledWith(req.params.id, req.user)
    expect(mockOrganizationService.updateOrganization).toHaveBeenCalledWith(req.params.id, req.body, req.user)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'organization',
      action: 'organization.update',
      status: 'success',
      targetType: 'organization',
      targetId: req.params.id,
      before: expect.objectContaining({
        billing: beforeOrganization.billing,
        settings: beforeOrganization.settings,
      }),
      after: expect.objectContaining({
        billing: afterOrganization.billing,
        settings: afterOrganization.settings,
      }),
    }))
    expect(res.json).toHaveBeenCalledWith({ success: true, data: afterOrganization })
  })
})
