import CreativeFactoryJob from '../src/models/CreativeFactoryJob'
import {
  createCreativeFactoryBatch,
  getCreativeFactoryStorageRoot,
  linkCreativeFactoryAttribution,
  validateCreativeFactoryStorageKey,
} from '../src/services/creativeFactory.service'

describe('creative factory orchestration', () => {
  afterEach(() => jest.restoreAllMocks())

  it('fans image sources out into idempotent variant tasks for Codex and ai-host', async () => {
    const insert = jest
      .spyOn(CreativeFactoryJob, 'insertMany')
      .mockImplementation(async (docs: any) => docs as any)
    const result = await createCreativeFactoryBatch(
      {
        title: 'US cold traffic',
        intent: 'Replace the original brand and make two 9:16 hooks',
        outputMediaType: 'video',
        variantsPerAsset: 2,
        assets: [
          { sourceUrl: 'https://cdn.example/source.jpg', mediaType: 'image' },
        ],
      },
      {
        userId: 'user-1',
        organizationId: '64b000000000000000000001',
        isSuperAdmin: false,
      },
    )

    expect(result.jobCount).toBe(2)
    const docs: any[] = insert.mock.calls[0][0] as any
    expect(docs.map((doc) => doc.variantId)).toEqual(['v001', 'v002'])
    expect(docs.every((doc) => doc.workflow === 'generate_then_edit')).toBe(
      true,
    )
    expect(docs.every((doc) => doc.codex.status === 'queued')).toBe(true)
  })

  it('routes existing videos directly to the Codex edit executor', async () => {
    const insert = jest
      .spyOn(CreativeFactoryJob, 'insertMany')
      .mockImplementation(async (docs: any) => docs as any)
    await createCreativeFactoryBatch(
      {
        title: 'Video rebrand',
        intent: 'Remove every original logo and replace it with ClingAI',
        outputMediaType: 'video',
        assets: [
          { sourceUrl: 'https://cdn.example/source.mp4', mediaType: 'video' },
        ],
      },
      {
        userId: 'user-1',
        organizationId: '64b000000000000000000001',
        isSuperAdmin: false,
      },
    )

    const docs: any[] = insert.mock.calls[0][0] as any
    expect(docs[0].workflow).toBe('edit_only')
  })

  it('links published ad mappings back to the producing job', async () => {
    const update = jest
      .spyOn(CreativeFactoryJob, 'updateMany')
      .mockResolvedValue({ modifiedCount: 1 } as any)
    await linkCreativeFactoryAttribution('64b000000000000000000002', {
      adId: 'ad-1',
      campaignId: 'campaign-1',
    })
    expect(update).toHaveBeenCalledWith(
      { outputMaterialId: '64b000000000000000000002' },
      expect.objectContaining({
        $set: expect.objectContaining({ 'attribution.status': 'linked' }),
        $addToSet: {
          'attribution.mappings': { adId: 'ad-1', campaignId: 'campaign-1' },
        },
      }),
    )
  })

  it('binds Codex outputs to the producing organization storage root', () => {
    const job = {
      organizationId: '64b000000000000000000001',
      createdBy: 'user-1',
    }
    const root = getCreativeFactoryStorageRoot(job)
    expect(root).toMatch(/^tenants\/org-[a-f0-9]{16}$/)
    expect(
      validateCreativeFactoryStorageKey(
        job,
        `${root}/creative-factory/2026-08-02/output.mp4`,
      ),
    ).toContain('/creative-factory/')
    expect(() =>
      validateCreativeFactoryStorageKey(
        job,
        'tenants/org-another/creative-factory/output.mp4',
      ),
    ).toThrow('成品存储路径不属于当前生产任务的租户')
  })
})
