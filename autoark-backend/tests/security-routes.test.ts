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
    ['GET', '/api/commercial/plans'],
  ] as const

  it.each(protectedRequests)('%s %s requires authentication', async (method, path) => {
    const response = await request(app)[method.toLowerCase() as 'get' | 'post'](path)
    expect(response.status).toBe(401)
  })
})
