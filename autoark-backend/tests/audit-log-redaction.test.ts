import OpsLog from '../src/models/OpsLog'
import { listAuditLogs, writeAuditLog } from '../src/services/auditLog.service'

describe('audit log sensitive data redaction', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('redacts tokens and secrets before writing audit logs while preserving safe ids', async () => {
    const create = jest.spyOn(OpsLog, 'create').mockResolvedValue({} as any)
    const req: any = {
      user: {
        userId: '665000000000000000000002',
        role: 'super_admin',
      },
      requestId: 'req_redact',
      ip: '127.0.0.1',
      get: jest.fn().mockReturnValue('jest'),
    }

    await writeAuditLog(req, {
      category: 'bulk_ad',
      action: 'bulk_ad.publish',
      status: 'failed',
      summary: 'Meta failed access_token=EAA12345678901234567890',
      reason: 'token=EAAABCDEFGHIJKLMNO12345 could not access page',
      metadata: {
        tokenId: '665000000000000000000014',
        tokenCount: 1,
        token: 'EAA_REAL_TOKEN_VALUE_123456',
        nested: {
          authorization: 'Bearer EAA_REAL_BEARER_TOKEN_123456',
          appSecret: 'secret-value',
          message: 'client_secret=super-secret access_token=EAAZZZZZZZZZZZZZZZZ',
        },
      },
    })

    const payload = create.mock.calls[0][0] as any
    expect(JSON.stringify(payload)).not.toContain('EAA12345678901234567890')
    expect(JSON.stringify(payload)).not.toContain('EAA_REAL_TOKEN_VALUE_123456')
    expect(JSON.stringify(payload)).not.toContain('super-secret')
    expect(payload.summary).toBe('Meta failed access_token=[REDACTED]')
    expect(payload.reason).toContain('token=[REDACTED]')
    expect(payload.metadata.token).toBe('[REDACTED]')
    expect(payload.metadata.nested.authorization).toBe('[REDACTED]')
    expect(payload.metadata.nested.appSecret).toBe('[REDACTED]')
    expect(payload.metadata.nested.message).toContain('client_secret=[REDACTED]')
    expect(payload.metadata.tokenId).toBe('665000000000000000000014')
    expect(payload.metadata.tokenCount).toBe(1)
  })

  it('sanitizes audit log list limits before querying', async () => {
    const limit = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    })
    const sort = jest.fn().mockReturnValue({ limit })
    jest.spyOn(OpsLog, 'find').mockReturnValue({ sort } as any)

    const currentUser: any = {
      userId: '665000000000000000000002',
      role: 'super_admin',
    }

    await listAuditLogs(currentUser, { limit: Number.NaN })
    await listAuditLogs(currentUser, { limit: 9999 })

    expect(limit).toHaveBeenNthCalledWith(1, 50)
    expect(limit).toHaveBeenNthCalledWith(2, 200)
  })
})
