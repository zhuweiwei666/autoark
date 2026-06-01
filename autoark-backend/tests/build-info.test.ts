import request from 'supertest'
import app from '../src/app'

describe('build info endpoint', () => {
  const originalEnv = {
    AUTOARK_DEPLOY_REF: process.env.AUTOARK_DEPLOY_REF,
    AUTOARK_DEPLOY_COMMIT: process.env.AUTOARK_DEPLOY_COMMIT,
    AUTOARK_DEPLOYED_AT: process.env.AUTOARK_DEPLOYED_AT,
    NODE_ENV: process.env.NODE_ENV,
  }

  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('returns safe deployment metadata without authentication', async () => {
    process.env.AUTOARK_DEPLOY_REF = 'feat/commercial-saas-foundation'
    process.env.AUTOARK_DEPLOY_COMMIT = '1234567890abcdef'
    process.env.AUTOARK_DEPLOYED_AT = '2026-06-01T12:00:00Z'
    process.env.NODE_ENV = 'production'

    const response = await request(app).get('/api/build')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: {
        service: 'autoark-backend',
        environment: 'production',
        ref: 'feat/commercial-saas-foundation',
        commit: '1234567890abcdef',
        shortCommit: '1234567890ab',
        deployedAt: '2026-06-01T12:00:00Z',
      },
    })
    expect(typeof response.body.data.uptime).toBe('number')
  })
})
