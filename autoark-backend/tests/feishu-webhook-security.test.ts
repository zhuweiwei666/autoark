const createResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
})

const loadController = async () => {
  jest.resetModules()
  return import('../src/controllers/feishu.webhook.controller')
}

describe('feishu webhook verification', () => {
  const originalNodeEnv = process.env.NODE_ENV
  const originalVerificationToken = process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN
  const originalLegacyVerificationToken = process.env.FEISHU_VERIFICATION_TOKEN
  const originalSigningSecret = process.env.FEISHU_WEBHOOK_SIGNING_SECRET
  const originalBotSecret = process.env.FEISHU_BOT_SECRET

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
    if (originalVerificationToken === undefined) {
      delete process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN
    } else {
      process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN = originalVerificationToken
    }
    if (originalLegacyVerificationToken === undefined) {
      delete process.env.FEISHU_VERIFICATION_TOKEN
    } else {
      process.env.FEISHU_VERIFICATION_TOKEN = originalLegacyVerificationToken
    }
    if (originalSigningSecret === undefined) {
      delete process.env.FEISHU_WEBHOOK_SIGNING_SECRET
    } else {
      process.env.FEISHU_WEBHOOK_SIGNING_SECRET = originalSigningSecret
    }
    if (originalBotSecret === undefined) {
      delete process.env.FEISHU_BOT_SECRET
    } else {
      process.env.FEISHU_BOT_SECRET = originalBotSecret
    }
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('rejects URL verification in production when no verification token is configured', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN
    delete process.env.FEISHU_VERIFICATION_TOKEN
    delete process.env.FEISHU_WEBHOOK_SIGNING_SECRET
    delete process.env.FEISHU_BOT_SECRET
    const { handleFeishuInteraction } = await loadController()
    const res = createResponse()

    await handleFeishuInteraction({
      body: {
        type: 'url_verification',
        challenge: 'challenge_1',
      },
      headers: {},
    } as any, res as any)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid verification token' })
  })

  it('accepts URL verification in production only when the verification token matches', async () => {
    process.env.NODE_ENV = 'production'
    process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN = 'verify-token'
    delete process.env.FEISHU_VERIFICATION_TOKEN
    delete process.env.FEISHU_WEBHOOK_SIGNING_SECRET
    delete process.env.FEISHU_BOT_SECRET
    const { handleFeishuInteraction } = await loadController()
    const res = createResponse()

    await handleFeishuInteraction({
      body: {
        type: 'url_verification',
        token: 'verify-token',
        challenge: 'challenge_1',
      },
      headers: {},
    } as any, res as any)

    expect(res.json).toHaveBeenCalledWith({ challenge: 'challenge_1' })
  })

  it('rejects unsigned interaction requests in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.FEISHU_WEBHOOK_VERIFICATION_TOKEN
    delete process.env.FEISHU_VERIFICATION_TOKEN
    delete process.env.FEISHU_WEBHOOK_SIGNING_SECRET
    delete process.env.FEISHU_BOT_SECRET
    const { handleFeishuInteraction } = await loadController()
    const res = createResponse()

    await handleFeishuInteraction({
      body: {
        action: { value: { action: 'approve', operationId: '665000000000000000000001' } },
        user: { open_id: 'ou_1', name: 'reviewer' },
      },
      headers: {},
    } as any, res as any)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid feishu signature' })
  })
})
