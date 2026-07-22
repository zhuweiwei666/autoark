const mockRecover = jest.fn()
const mockRetryFailures = jest.fn()
const mockOriginalImageBackfill = jest.fn()
const mockMaterialDeduplication = jest.fn()
const mockWriteAuditLog = jest.fn()

jest.mock('../src/services/facebook.campaigns.v2.service', () => ({
  recoverFacebookAccountQueue: mockRecover,
  retryFacebookQueueFailures: mockRetryFailures,
}))

jest.mock('../src/services/facebookMaterialBackfill.service', () => ({
  backfillFacebookOriginalImages: mockOriginalImageBackfill,
}))

jest.mock('../src/services/facebookMaterialDeduplication.service', () => ({
  deduplicateFacebookMaterials: mockMaterialDeduplication,
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: mockWriteAuditLog,
}))

import { UserRole } from '../src/models/User'
import {
  backfillOriginalImages,
  deduplicateMaterials,
  recoverQueue,
  retryFailedQueueJobs,
} from '../src/controllers/facebook.controller'

const response = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
})

describe('facebook queue recovery controller', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRecover.mockResolvedValue({
      dryRun: true,
      candidates: 10,
      removed: 0,
      byState: { prioritized: 8, waiting: 0, delayed: 0, failed: 2 },
    })
    mockRetryFailures.mockResolvedValue({
      queue: 'ad',
      dryRun: true,
      candidates: 83,
      retried: 0,
    })
    mockOriginalImageBackfill.mockResolvedValue({
      dryRun: true,
      totalCandidates: 671,
      selected: 671,
      eligible: 650,
      skippedNoToken: 21,
      queued: 0,
    })
    mockMaterialDeduplication.mockResolvedValue({
      dryRun: true,
      totalMaterials: 1634,
      distinctFiles: 723,
      duplicateGroups: 229,
      duplicateDocuments: 911,
      mergedGroups: 0,
      archivedDocuments: 0,
      deletedDocuments: 0,
    })
  })

  it('defaults to a non-destructive dry run and audits it', async () => {
    const req: any = {
      user: { role: UserRole.SUPER_ADMIN, userId: '665000000000000000000001' },
      body: {},
      get: jest.fn(),
    }
    const res: any = response()
    const next = jest.fn()

    await recoverQueue(req, res, next)

    expect(mockRecover).toHaveBeenCalledWith({
      dryRun: true,
      confirmation: undefined,
      maxJobs: undefined,
    })
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'facebook.queue.recover.preview',
      status: 'success',
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ dryRun: true, removed: 0 }),
    }))
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects non-superadmins before accessing the queue', async () => {
    const req: any = {
      user: { role: UserRole.ORG_ADMIN },
      body: { dryRun: false, confirmation: 'RECOVER_FACEBOOK_ACCOUNT_QUEUE' },
    }
    const res: any = response()

    await recoverQueue(req, res, jest.fn())

    expect(res.status).toHaveBeenCalledWith(403)
    expect(mockRecover).not.toHaveBeenCalled()
  })

  it('previews failed-job retries for one selected queue and audits it', async () => {
    const req: any = {
      user: { role: UserRole.SUPER_ADMIN, userId: '665000000000000000000001' },
      body: { queue: 'ad', maxJobs: 100 },
      get: jest.fn(),
    }
    const res: any = response()
    const next = jest.fn()

    await retryFailedQueueJobs(req, res, next)

    expect(mockRetryFailures).toHaveBeenCalledWith({
      queue: 'ad',
      dryRun: true,
      confirmation: undefined,
      maxJobs: 100,
    })
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'facebook.queue.retry_failed.preview',
      status: 'success',
      targetId: 'facebook.ad.sync',
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    expect(next).not.toHaveBeenCalled()
  })

  it('previews original image backfill and records an audit event', async () => {
    const req: any = {
      user: { role: UserRole.SUPER_ADMIN, userId: '665000000000000000000001' },
      body: { maxJobs: 1000 },
      get: jest.fn(),
    }
    const res: any = response()
    const next = jest.fn()

    await backfillOriginalImages(req, res, next)

    expect(mockOriginalImageBackfill).toHaveBeenCalledWith({
      dryRun: true,
      confirmation: undefined,
      maxJobs: 1000,
    })
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'facebook.material.original_image_backfill.preview',
      status: 'success',
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    expect(next).not.toHaveBeenCalled()
  })

  it('previews Facebook material deduplication and records an audit event', async () => {
    const req: any = {
      user: { role: UserRole.SUPER_ADMIN, userId: '665000000000000000000001' },
      body: { maxGroups: 1000 },
      get: jest.fn(),
    }
    const res: any = response()
    const next = jest.fn()

    await deduplicateMaterials(req, res, next)

    expect(mockMaterialDeduplication).toHaveBeenCalledWith({
      dryRun: true,
      confirmation: undefined,
      maxGroups: 1000,
    })
    expect(mockWriteAuditLog).toHaveBeenCalledWith(req, expect.objectContaining({
      action: 'facebook.material.deduplicate.preview',
      status: 'success',
    }))
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    expect(next).not.toHaveBeenCalled()
  })
})
