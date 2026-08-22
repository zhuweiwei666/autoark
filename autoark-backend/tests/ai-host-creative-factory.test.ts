import crypto from 'crypto'
import { createAiHostGeneration } from '../src/services/aiHostCreativeFactory.service'

describe('ai-host creative factory client', () => {
  const originalSecret = process.env.AI_HOST_INTERNAL_API_SECRET
  const originalUrl = process.env.AI_HOST_CREATIVE_FACTORY_URL

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalSecret === undefined)
      delete process.env.AI_HOST_INTERNAL_API_SECRET
    else process.env.AI_HOST_INTERNAL_API_SECRET = originalSecret
    if (originalUrl === undefined)
      delete process.env.AI_HOST_CREATIVE_FACTORY_URL
    else process.env.AI_HOST_CREATIVE_FACTORY_URL = originalUrl
  })

  it('sends the path-bound V2 envelope plus the rollout-compatible legacy signature', async () => {
    const secret = 'creative-factory-test-secret-32chars'
    process.env.AI_HOST_INTERNAL_API_SECRET = secret
    process.env.AI_HOST_CREATIVE_FACTORY_URL =
      'https://cling.example/internal/creative-factory'
    const body = {
      externalBatchId: 'batch-1',
      externalVariantId: 'v001',
      sourceImageUrl: 'https://cdn.example/source.jpg',
      featureKey: 'video',
      creativeDirection: 'Fast cuts and a result-first hook.',
      styleReference: {
        materialId: 'reference-1',
        url: 'https://cdn.example/reference.mp4',
        mediaType: 'video' as const,
      },
    }
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { status: 'pending', generationId: 'gen-1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(createAiHostGeneration(body)).resolves.toMatchObject({
      status: 'pending',
      generationId: 'gen-1',
    })
    const [, options] = fetchMock.mock.calls[0]
    const serialized = JSON.stringify(body)
    const headers = options?.headers as Record<string, string>
    const timestamp = headers['X-Creative-Factory-Timestamp']
    const nonce = headers['X-Creative-Factory-Nonce']
    const bodyDigest = crypto
      .createHash('sha256')
      .update(serialized)
      .digest('hex')
    const payload = [
      'creative-factory-request-v2',
      'service:creative-factory',
      'method:POST',
      'path:/internal/creative-factory/generate',
      `timestamp:${timestamp}`,
      `nonce:${nonce}`,
      `body-sha256:${bodyDigest}`,
    ].join('\n')
    const expectedV2 = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex')
    const expectedLegacy = crypto
      .createHmac('sha256', secret)
      .update(serialized)
      .digest('hex')
    expect(options?.body).toBe(serialized)
    expect(headers['X-Creative-Factory-Id']).toBe('creative-factory')
    expect(timestamp).toMatch(/^\d{13}$/)
    expect(nonce).toMatch(/^[a-f0-9]{32}$/)
    expect(headers['X-Creative-Factory-Signature']).toBe(expectedV2)
    expect(headers['X-Internal-Signature']).toBe(expectedLegacy)
  })

  it('fails closed when the shared secret is missing', async () => {
    delete process.env.AI_HOST_INTERNAL_API_SECRET
    await expect(
      createAiHostGeneration({
        externalBatchId: 'batch-1',
        externalVariantId: 'v001',
        sourceImageUrl: 'https://cdn.example/source.jpg',
        featureKey: 'video',
      }),
    ).rejects.toThrow('AI_HOST_INTERNAL_API_SECRET 未安全配置')
  })

  it('fails closed when the shared secret is too short', async () => {
    process.env.AI_HOST_INTERNAL_API_SECRET = 'short-secret'
    await expect(
      createAiHostGeneration({
        externalBatchId: 'batch-1',
        externalVariantId: 'v001',
        sourceImageUrl: 'https://cdn.example/source.jpg',
        featureKey: 'video',
      }),
    ).rejects.toThrow('AI_HOST_INTERNAL_API_SECRET 未安全配置')
  })
})
