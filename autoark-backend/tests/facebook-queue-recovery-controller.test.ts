const mockRecover = jest.fn()
const mockWriteAuditLog = jest.fn()

jest.mock('../src/services/facebook.campaigns.v2.service', () => ({
  recoverFacebookAccountQueue: mockRecover,
}))

jest.mock('../src/services/auditLog.service', () => ({
  writeAuditLog: mockWriteAuditLog,
}))

import { UserRole } from '../src/models/User'
import { recoverQueue } from '../src/controllers/facebook.controller'

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
})
