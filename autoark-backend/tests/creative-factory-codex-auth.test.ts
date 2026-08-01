import crypto from 'crypto'
import express from 'express'
import request from 'supertest'
import routes from '../src/routes/creativeFactory.routes'

describe('creative factory Codex boundary', () => {
  const app = express()
  app.use(express.json())
  app.use('/api/creative-factory', routes)
  const originalSecret = process.env.CREATIVE_FACTORY_CODEX_SECRET

  afterEach(() => {
    if (originalSecret === undefined)
      delete process.env.CREATIVE_FACTORY_CODEX_SECRET
    else process.env.CREATIVE_FACTORY_CODEX_SECRET = originalSecret
  })

  it('fails closed when the executor secret is not configured', async () => {
    delete process.env.CREATIVE_FACTORY_CODEX_SECRET
    const response = await request(app)
      .post('/api/creative-factory/codex/claim')
      .send({ workerId: 'test' })
    expect(response.status).toBe(503)
  })

  it('rejects an invalid Codex signature before touching the task queue', async () => {
    process.env.CREATIVE_FACTORY_CODEX_SECRET = 'test-secret'
    const response = await request(app)
      .post('/api/creative-factory/codex/claim')
      .set(
        'X-Codex-Signature',
        crypto.createHash('sha256').update('wrong').digest('hex'),
      )
      .send({ workerId: 'test' })
    expect(response.status).toBe(401)
  })
})
