import CreativeFactoryJob from '../src/models/CreativeFactoryJob'
import Material from '../src/models/Material'
import {
  claimCreativeFactoryJob,
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

  it.each([
    ['image', 'image', 'edit_only', 'image'],
    ['video', 'image', 'extract_frame_then_edit', 'image'],
    ['image', 'video', 'generate_then_edit', 'video'],
    ['video', 'video', 'edit_only', 'video'],
  ] as const)(
    'routes %s source with %s example through %s',
    async (sourceType, referenceType, expectedWorkflow, expectedOutput) => {
      jest.spyOn(Material, 'findOne').mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: '64b000000000000000000099',
          type: referenceType,
          name: `${referenceType} example`,
          storage: {
            url: `https://cdn.example/reference.${referenceType === 'video' ? 'mp4' : 'jpg'}`,
          },
        }),
      } as any)
      const insert = jest
        .spyOn(CreativeFactoryJob, 'insertMany')
        .mockImplementation(async (docs: any) => docs as any)

      await createCreativeFactoryBatch(
        {
          title: 'Reference matrix',
          intent: 'Apply the example advertising language',
          outputMediaType: expectedOutput === 'video' ? 'image' : 'video',
          assets: [
            {
              sourceUrl: `https://cdn.example/source.${sourceType === 'video' ? 'mp4' : 'jpg'}`,
              mediaType: sourceType,
            },
          ],
          styleReference: { materialId: '64b000000000000000000099' },
        },
        {
          userId: 'user-1',
          organizationId: '64b000000000000000000001',
          isSuperAdmin: false,
        },
      )

      const docs: any[] = insert.mock.calls[0][0] as any
      expect(docs[0]).toMatchObject({
        workflow: expectedWorkflow,
        requestedOutput: { mediaType: expectedOutput },
        styleReference: {
          mediaType: referenceType,
          analysis: { status: 'pending' },
        },
      })
    },
  )

  it('only releases the first variant until the shared example analysis exists', async () => {
    const lean = jest.fn().mockResolvedValue(null)
    const claim = jest
      .spyOn(CreativeFactoryJob, 'findOneAndUpdate')
      .mockReturnValue({ lean } as any)
    await claimCreativeFactoryJob('codex-test')
    expect(claim.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              expect.objectContaining({ variantId: 'v001' }),
              { 'styleReference.analysis.status': 'completed' },
            ]),
          }),
        ]),
      }),
    )
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
