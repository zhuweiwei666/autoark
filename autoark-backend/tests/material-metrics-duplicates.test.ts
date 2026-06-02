import Creative from '../src/models/Creative'
import { findDuplicateMaterials } from '../src/services/materialMetrics.service'

const detailRowsByKey: Record<string, Array<{ creativeId: string; thumbnailUrl?: string }>> = {
  hash_1: [
    { creativeId: 'creative_1', thumbnailUrl: 'https://cdn.test/hash_1.jpg' },
    { creativeId: 'creative_2' },
    { creativeId: 'creative_3' },
  ],
  video_1: [
    { creativeId: 'creative_4', thumbnailUrl: 'https://cdn.test/video_1.jpg' },
    { creativeId: 'creative_5' },
    { creativeId: 'creative_6' },
  ],
}

const queryChain = (match: Record<string, string>) => {
  let selectedLimit = 0
  const key = match.imageHash || match.videoId
  const chain = {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn((limit: number) => {
      selectedLimit = limit
      return chain
    }),
    lean: jest.fn().mockImplementation(async () => (detailRowsByKey[key] || []).slice(0, selectedLimit)),
  }

  return chain
}

describe('material metrics duplicates', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns bounded duplicate details while preserving group totals', async () => {
    jest.spyOn(Creative, 'aggregate').mockImplementation(async (pipeline: any[]) => {
      const groupStage = pipeline.find((stage) => stage.$group)?.$group
      const pipelineText = JSON.stringify(pipeline)

      if (groupStage?._id === '$imageHash') {
        return [{ _id: 'hash_1', count: 3, thumbnail: 'https://cdn.test/fallback-hash.jpg' }] as any
      }
      if (groupStage?._id === '$videoId') {
        return [{ _id: 'video_1', count: 3, thumbnail: 'https://cdn.test/fallback-video.jpg' }] as any
      }
      if (pipelineText.includes('"key":"$imageHash"')) {
        return [{ _id: 'hash_1', accountsCount: 2 }] as any
      }
      if (pipelineText.includes('"key":"$videoId"')) {
        return [{ _id: 'video_1', accountsCount: 1 }] as any
      }

      return [] as any
    })
    jest.spyOn(Creative, 'find').mockImplementation((match: any) => queryChain(match) as any)

    const duplicates = await findDuplicateMaterials({ groupLimit: 10, detailLimit: 2 })

    expect(Creative.find).toHaveBeenCalledWith({ imageHash: 'hash_1' })
    expect(Creative.find).toHaveBeenCalledWith({ videoId: 'video_1' })
    expect(JSON.stringify((Creative.aggregate as jest.Mock).mock.calls[0][0])).not.toContain('$push')
    expect(duplicates.byImageHash[0]).toMatchObject({
      imageHash: 'hash_1',
      usageCount: 3,
      creativeIds: ['creative_1', 'creative_2'],
      creativeIdsTotal: 3,
      creativeIdsReturned: 2,
      creativeIdsTruncated: true,
      accountsCount: 2,
      thumbnail: 'https://cdn.test/hash_1.jpg',
    })
    expect(duplicates.byVideoId[0]).toMatchObject({
      videoId: 'video_1',
      creativeIds: ['creative_4', 'creative_5'],
      accountsCount: 1,
    })
    expect(duplicates.limits).toMatchObject({
      groups: {
        maxReturned: 10,
        imageReturned: 1,
        videoReturned: 1,
      },
      creativeIds: {
        maxReturnedPerGroup: 2,
      },
    })
  })
})
