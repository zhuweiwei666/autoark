jest.mock('../src/services/organization.service', () => ({
  __esModule: true,
  default: {
    getOrganizations: jest.fn(),
    getOrganizationById: jest.fn(),
    getOrganizationMembers: jest.fn(),
    updateOrganization: jest.fn(),
    transferAdmin: jest.fn(),
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

  it('caps organization list pagination and returns pagination metadata', async () => {
    mockOrganizationService.getOrganizations.mockResolvedValue({
      data: [{ _id: '665000000000000000000001', name: 'Acme Team' }],
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
        page: '3',
        limit: '9999',
        status: { $ne: OrganizationStatus.SUSPENDED },
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await organizationController.getOrganizations(req, res)

    expect(mockOrganizationService.getOrganizations).toHaveBeenCalledWith(
      req.user,
      { status: undefined },
      { page: 3, pageSize: 100, skip: 200 },
    )
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: '665000000000000000000001', name: 'Acme Team' }],
      total: 250,
      pagination: {
        page: 3,
        pageSize: 100,
        total: 250,
        totalPages: 3,
      },
    })
  })

  it('caps organization member list pagination', async () => {
    mockOrganizationService.getOrganizationMembers.mockResolvedValue({
      data: [{ _id: '665000000000000000000101', username: 'member' }],
      total: 101,
      page: 2,
      pageSize: 100,
    } as any)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: { id: '665000000000000000000001' },
      query: {
        page: '2',
        pageSize: '9999',
      },
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await organizationController.getOrganizationMembers(req, res)

    expect(mockOrganizationService.getOrganizationMembers).toHaveBeenCalledWith(
      req.params.id,
      req.user,
      { page: 2, pageSize: 100, skip: 100 },
    )
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: '665000000000000000000101', username: 'member' }],
      total: 101,
      pagination: {
        page: 2,
        pageSize: 100,
        total: 101,
        totalPages: 2,
      },
    })
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

  it('audits before and after snapshots when transferring organization admin', async () => {
    const beforeOrganization = {
      _id: '665000000000000000000001',
      name: 'Acme Team',
      adminId: '665000000000000000000101',
    }
    const afterOrganization = {
      ...beforeOrganization,
      adminId: '665000000000000000000102',
    }

    mockOrganizationService.getOrganizationById.mockResolvedValue(beforeOrganization as any)
    mockOrganizationService.transferAdmin.mockResolvedValue(afterOrganization as any)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: { id: '665000000000000000000001' },
      body: { newAdminId: '665000000000000000000102' },
      requestId: 'req_org_transfer',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await organizationController.transferAdmin(req, res)

    expect(mockOrganizationService.getOrganizationById).toHaveBeenCalledWith(req.params.id, req.user)
    expect(mockOrganizationService.transferAdmin).toHaveBeenCalledWith(
      req.params.id,
      req.body.newAdminId,
      req.user,
    )
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'organization',
      action: 'organization.transfer_admin',
      status: 'success',
      targetType: 'organization',
      targetId: req.params.id,
      before: { adminId: beforeOrganization.adminId },
      after: {
        adminId: afterOrganization.adminId,
        newAdminId: req.body.newAdminId,
      },
    }))
    expect(res.json).toHaveBeenCalledWith({ success: true, data: afterOrganization })
  })

  it('audits failed organization admin transfers', async () => {
    mockOrganizationService.getOrganizationById.mockRejectedValue(new Error('组织不存在'))
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: { id: '665000000000000000000404' },
      body: { newAdminId: '665000000000000000000102' },
      requestId: 'req_org_transfer_failed',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await organizationController.transferAdmin(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'organization',
      action: 'organization.transfer_admin',
      status: 'failed',
      targetType: 'organization',
      targetId: req.params.id,
      reason: '组织不存在',
      after: { newAdminId: req.body.newAdminId },
    }))
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '组织不存在',
    })
  })

  it('rejects unsafe transfer admin ids before calling the service', async () => {
    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      params: { id: '665000000000000000000001' },
      body: { newAdminId: { $ne: '665000000000000000000102' } },
      requestId: 'req_org_transfer_unsafe',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await organizationController.transferAdmin(req, res)

    expect(mockOrganizationService.getOrganizationById).not.toHaveBeenCalled()
    expect(mockOrganizationService.transferAdmin).not.toHaveBeenCalled()
    expect(mockWriteAuditLog).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: '新管理员ID不能为空',
    })
  })
})
