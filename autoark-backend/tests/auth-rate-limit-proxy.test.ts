process.env.TRUST_PROXY_HOPS = '1'
process.env.AUTH_RATE_LIMIT_MAX = '1'
process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000'

const request = require('supertest')
const app = require('../src/app').default

const loginWithoutCredentials = (ip: string) => request(app)
  .post('/api/auth/login')
  .set('x-forwarded-for', ip)
  .send({})

describe('auth rate limit proxy handling', () => {
  it('uses the forwarded client IP instead of collapsing all proxied logins together', async () => {
    const firstSameIp = await loginWithoutCredentials('203.0.113.10')
    const secondSameIp = await loginWithoutCredentials('203.0.113.10')
    const differentIp = await loginWithoutCredentials('203.0.113.11')

    expect(firstSameIp.status).toBe(400)
    expect(secondSameIp.status).toBe(429)
    expect(differentIp.status).toBe(400)
  })
})
