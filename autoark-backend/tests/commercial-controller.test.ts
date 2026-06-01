jest.mock('../src/services/commercial.service', () => ({
  getCommercialReadiness: jest.fn(),
  getCommercialPlans: jest.fn(),
  getCommercialOrganizationReadiness: jest.fn(),
  getCommercialSupportPackage: jest.fn(),
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: jest.fn(),
}))

import { getCommercialSupportPackage } from '../src/services/commercial.service'
import { writeAuditLog } from '../src/services/auditLog.service'
import { getSupportPackage } from '../src/controllers/commercial.controller'
import { UserRole } from '../src/models/User'

const mockGetCommercialSupportPackage = getCommercialSupportPackage as jest.Mock
const mockWriteAuditLog = writeAuditLog as jest.Mock

describe('commercial controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('writes an audit log when a commercial support package is generated', async () => {
    const supportPackage = {
      supportId: 'AUTOARK-20260601170000-000001',
      generatedAt: '2026-06-01T17:00:00.000Z',
      system: {
        build: {
          ref: 'feat/commercial-saas-foundation',
          commit: '1234567890abcdef',
          shortCommit: '1234567890ab',
          deployedAt: '2026-06-01T12:00:00Z',
        },
      },
      scope: {
        mode: 'organization',
        organizationId: '665000000000000000000001',
        organizationName: 'Acme Team',
        organizationStatus: 'active',
      },
      readiness: {
        score: 72,
        state: { level: 'attention', label: '需关注' },
        risks: [{ level: 'warning', title: '需要补齐 Pixel' }],
        nextActions: [{ id: 'assign_facebook_pixel' }],
        metrics: { facebookReadyAccounts: 2 },
        deployment: {
          facebookBusinessLoginConfigConfigured: true,
          oauthStateSecretConfigured: true,
        },
      },
      facebookAssets: {
        summary: {
          tokenCount: 1,
          accountCount: 3,
          readyAccountCount: 2,
          expiredTokenCount: 0,
          expiringSoonTokenCount: 1,
          staleTokenCheckCount: 0,
          tokenWithoutExpiryCount: 0,
          earliestTokenExpiresAt: '2026-07-01T00:00:00.000Z',
        },
        risks: [{ level: 'warning', message: 'Token 将在 14 天内过期。' }],
        checklist: [],
        accounts: [],
      },
      recentTasks: [{ taskId: 'task_1' }],
      recentAuditLogs: [],
    }

    mockGetCommercialSupportPackage.mockResolvedValue(supportPackage)
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      query: {
        organizationId: '665000000000000000000001',
      },
      requestId: 'req_1',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getSupportPackage(req, res)

    expect(mockGetCommercialSupportPackage).toHaveBeenCalledWith(
      req.user,
      '665000000000000000000001',
    )
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'commercial',
      action: 'commercial.support_package.generate',
      status: 'success',
      organizationId: '665000000000000000000001',
      targetType: 'commercial_support_package',
      targetId: 'AUTOARK-20260601170000-000001',
      summary: '生成客户支持包 Acme Team：需关注',
      metadata: expect.objectContaining({
        supportId: 'AUTOARK-20260601170000-000001',
        readinessScore: 72,
        readinessState: 'attention',
        readinessLabel: '需关注',
        buildRef: 'feat/commercial-saas-foundation',
        buildCommit: '1234567890abcdef',
        buildShortCommit: '1234567890ab',
        buildDeployedAt: '2026-06-01T12:00:00Z',
        businessLoginConfigConfigured: true,
        oauthStateSecretConfigured: true,
        readyAccountCount: 2,
        accountCount: 3,
        tokenCount: 1,
        expiredTokenCount: 0,
        expiringSoonTokenCount: 1,
        staleTokenCheckCount: 0,
        tokenWithoutExpiryCount: 0,
        earliestTokenExpiresAt: '2026-07-01T00:00:00.000Z',
        facebookRiskCount: 1,
        firstFacebookAssetRisk: 'Token 将在 14 天内过期。',
        recentTaskCount: 1,
        riskCount: 1,
        nextActionIds: ['assign_facebook_pixel'],
      }),
    }))
    expect(res.json).toHaveBeenCalledWith({ success: true, data: supportPackage })
  })

  it('writes a failed audit log when support package generation fails', async () => {
    mockGetCommercialSupportPackage.mockRejectedValue(new Error('无权查看该组织'))
    mockWriteAuditLog.mockResolvedValue(undefined)

    const req: any = {
      user: {
        userId: 'admin_1',
        role: UserRole.SUPER_ADMIN,
      },
      query: {
        organizationId: '665000000000000000000001',
      },
      requestId: 'req_2',
      ip: '127.0.0.1',
      get: jest.fn(),
    }
    const res: any = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    }

    await getSupportPackage(req, res)

    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      category: 'commercial',
      action: 'commercial.support_package.generate',
      status: 'failed',
      organizationId: '665000000000000000000001',
      targetType: 'commercial_support_package',
      summary: '生成客户支持包失败',
      reason: '无权查看该组织',
      metadata: expect.objectContaining({
        requestedOrganizationId: '665000000000000000000001',
        statusCode: 403,
      }),
    }))
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '无权查看该组织' })
  })
})
