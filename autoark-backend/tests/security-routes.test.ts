import request from 'supertest'
import app from '../src/app'

describe('protected API routes', () => {
  const protectedRequests = [
    ['GET', '/api/product-mapping/stats'],
    ['POST', '/api/product-mapping/products'],
    ['GET', '/api/user-settings/campaign-columns'],
    ['POST', '/api/user-settings/campaign-columns'],
    ['GET', '/api/agg/daily'],
    ['POST', '/api/agg/refresh'],
    ['GET', '/api/commercial/readiness'],
    ['GET', '/api/commercial/organizations/readiness'],
    ['GET', '/api/commercial/support-package'],
    ['GET', '/api/commercial/usage-ledger'],
    ['GET', '/api/commercial/plans'],
    ['GET', '/api/audit-logs'],
    ['GET', '/api/bulk-ad/tasks/665000000000000000000001/diagnostics'],
    ['GET', '/api/bulk-ad/tasks/665000000000000000000001/support-package'],
  ] as const

  it.each(protectedRequests)('%s %s requires authentication', async (method, path) => {
    const response = await request(app)[method.toLowerCase() as 'get' | 'post'](path)
    expect(response.status).toBe(401)
  })

  it('adds requestId to manual JSON error responses', async () => {
    const response = await request(app)
      .get('/api/audit-logs')
      .set('x-request-id', 'req_manual_error')

    expect(response.status).toBe(401)
    expect(response.headers['x-request-id']).toBe('req_manual_error')
    expect(response.body).toMatchObject({
      success: false,
      requestId: 'req_manual_error',
    })
  })
})
