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

  it('signs the exact JSON body and unwraps ai-host data', async () => {
    process.env.AI_HOST_INTERNAL_API_SECRET = 'test-secret'
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
    const expected = crypto
      .createHmac('sha256', 'test-secret')
      .update(serialized)
      .digest('hex')
    expect(options?.body).toBe(serialized)
    expect(
      (options?.headers as Record<string, string>)['X-Internal-Signature'],
    ).toBe(expected)
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
    ).rejects.toThrow('AI_HOST_INTERNAL_API_SECRET 未配置')
  })
})
