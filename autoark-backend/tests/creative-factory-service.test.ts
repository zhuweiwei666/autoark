import CreativeFactoryJob from '../src/models/CreativeFactoryJob'
import Material from '../src/models/Material'
import {
  claimCreativeFactoryJob,
  createCreativeFactoryBatch,
  getCreativeFactoryStorageRoot,
  linkCreativeFactoryAttribution,
  validateCreativeFactoryStorageKey,
} from '../src/services/creativeFactory.service'
import {
  DUAL_SCENE_TEMPLATE_KEY,
  listCreativeFactoryTemplates,
} from '../src/config/creativeFactoryTemplates.config'
import { buildDualSceneFilter } from '../src/services/creativeFactoryTemplateWorker.service'

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

  it('standardizes one image into the fixed dual-scene pipeline', async () => {
    const insert = jest
      .spyOn(CreativeFactoryJob, 'insertMany')
      .mockImplementation(async (docs: any) => docs as any)

    const result = await createCreativeFactoryBatch(
      {
        title: 'Dual scene template',
        intent: 'Create the approved ClingAI reveal ad',
        templateKey: DUAL_SCENE_TEMPLATE_KEY,
        outputMediaType: 'image',
        variantsPerAsset: 4,
        assets: [
          {
            sourceUrl: 'https://cdn.example/adult-source.jpg',
            mediaType: 'image',
          },
        ],
      },
      {
        userId: 'user-1',
        organizationId: '64b000000000000000000001',
        isSuperAdmin: false,
      },
    )

    expect(result.jobCount).toBe(1)
    const docs: any[] = insert.mock.calls[0][0] as any
    expect(docs[0]).toMatchObject({
      templateKey: DUAL_SCENE_TEMPLATE_KEY,
      templateVersion: 1,
      status: 'generating',
      requestedOutput: { mediaType: 'video', aspectRatio: '9:16' },
      pipeline: {
        status: 'queued',
        currentStep: 'closeup_image',
        attempts: 0,
      },
      codex: { status: 'completed' },
    })
  })

  it('rejects video inputs and style overrides for the fixed template', async () => {
    const scope = {
      userId: 'user-1',
      organizationId: '64b000000000000000000001',
      isSuperAdmin: false,
    }
    await expect(
      createCreativeFactoryBatch(
        {
          title: 'Wrong source type',
          intent: 'Create the approved ClingAI reveal ad',
          templateKey: DUAL_SCENE_TEMPLATE_KEY,
          assets: [
            {
              sourceUrl: 'https://cdn.example/source.mp4',
              mediaType: 'video',
            },
          ],
        },
        scope,
      ),
    ).rejects.toThrow('只接受图片来源素材')

    await expect(
      createCreativeFactoryBatch(
        {
          title: 'Wrong style override',
          intent: 'Create the approved ClingAI reveal ad',
          templateKey: DUAL_SCENE_TEMPLATE_KEY,
          assets: [
            {
              sourceUrl: 'https://cdn.example/source.jpg',
              mediaType: 'image',
            },
          ],
          styleReference: { materialId: '64b000000000000000000000099' },
        },
        scope,
      ),
    ).rejects.toThrow('已经固化广告结构')
  })

  it('publishes only the safe template contract and locks the reveal timing', () => {
    expect(listCreativeFactoryTemplates()).toEqual([
      expect.objectContaining({
        key: DUAL_SCENE_TEMPLATE_KEY,
        inputMediaType: 'image',
        outputMediaType: 'video',
        variantsPerAsset: 1,
      }),
    ])
    expect(listCreativeFactoryTemplates()[0]).not.toHaveProperty('generation')
    expect(listCreativeFactoryTemplates()[0]).not.toHaveProperty('composition')

    const filter = buildDualSceneFilter({
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 5,
      revealStartSeconds: 0.233333,
      revealEndSeconds: 2.8,
      revealOpacity: 0.56,
    })
    expect(filter).toContain('between(T,0.233333,2.799999)')
    expect(filter).toContain('A*0.44+B*0.56')
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
