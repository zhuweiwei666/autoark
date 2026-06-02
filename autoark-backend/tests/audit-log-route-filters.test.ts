import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

jest.mock('../src/services/auditLog.service', () => ({
  AUDIT_LOG_STATUSES: ['success', 'failed', 'warning'],
  listAuditLogs: jest.fn(),
}))

const mockAuthState: { user: any } = {
  user: {
    role: UserRole.SUPER_ADMIN,
    userId: '665000000000000000000002',
  },
}

jest.mock('../src/middlewares/auth', () => {
  const actual = jest.requireActual('../src/middlewares/auth')
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = mockAuthState.user
      next()
    },
  }
})

import auditLogRoutes from '../src/routes/auditLog.routes'
import { listAuditLogs } from '../src/services/auditLog.service'

const createApp = () => {
  const app = express()
  app.use('/api/audit-logs', auditLogRoutes)
  return app
}

describe('audit log route filters', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000002',
    }
    ;(listAuditLogs as jest.Mock).mockResolvedValue([])
  })

  it('sanitizes audit log filters before listing', async () => {
    const response = await request(createApp())
      .get('/api/audit-logs?organizationId=665000000000000000000001&category=%20auth%20&action=%20auth.login%20&status=unknown&limit=9999')

    expect(response.status).toBe(200)
    expect(listAuditLogs).toHaveBeenCalledWith(mockAuthState.user, {
      organizationId: '665000000000000000000001',
      category: 'auth',
      action: 'auth.login',
      status: '',
      limit: 200,
    })
  })
})
