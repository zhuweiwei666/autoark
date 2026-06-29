process.env.MATERIAL_MAX_UPLOAD_BYTES = '5'
process.env.MATERIAL_MAX_BATCH_FILES = '2'

jest.mock('../src/middlewares/auth', () => {
  const actual = jest.requireActual('../src/middlewares/auth')
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        userId: '665000000000000000000002',
        organizationId: '665000000000000000000001',
        role: 'member',
      }
      next()
    },
  }
})

const express = require('express')
const request = require('supertest')
const materialRoutes = require('../src/routes/material.routes').default

const createApp = () => {
  const app = express()
  app.use('/api/materials', materialRoutes)
  return app
}

describe('material upload route errors', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('returns a stable JSON error for unsupported file types', async () => {
    const response = await request(createApp())
      .post('/api/materials/upload')
      .attach('file', Buffer.from('plain text'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      error: '只支持图片和视频文件',
    })
  })

  it('returns a stable JSON error for oversized uploads', async () => {
    const response = await request(createApp())
      .post('/api/materials/upload')
      .attach('file', Buffer.from('larger-than-limit'), {
        filename: 'creative.jpg',
        contentType: 'image/jpeg',
      })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      error: '文件大小超过限制（最大 5B）',
    })
  })

  it('returns a stable JSON error when batch upload exceeds the configured count', async () => {
    const pending = request(createApp()).post('/api/materials/upload-batch')

    for (let index = 0; index < 3; index++) {
      pending.attach('files', Buffer.from('ok'), {
        filename: `creative-${index}.jpg`,
        contentType: 'image/jpeg',
      })
    }

    const response = await pending

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      success: false,
      error: '一次最多上传 2 个文件',
    })
  })
})
