import Ad from '../src/models/Ad'
import Creative from '../src/models/Creative'
import MaterialMetrics from '../src/models/MaterialMetrics'
import { getMaterialUsage } from '../src/services/materialMetrics.service'

const queryChain = (value: any[]) => ({
  select: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value),
})

describe('material metrics usage', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('uses bounded ad details and direct material metric matching', async () => {
    const ads = Array.from({ length: 20 }, (_, index) => ({
      adId: `ad_${index + 1}`,
      accountId: index % 2 === 0 ? 'act_1' : 'act_2',
      campaignId: 'camp_1',
    }))
    const creativeFind = queryChain([{ creativeId: 'creative_1', thumbnailUrl: 'https://cdn.test/thumb.jpg', type: 'image' }])
    const adFind = queryChain(ads)

    jest.spyOn(Creative, 'find').mockReturnValue(creativeFind as any)
    jest.spyOn(Creative, 'countDocuments').mockResolvedValue(25 as any)
    jest.spyOn(Ad, 'find').mockReturnValue(adFind as any)
    jest.spyOn(Ad, 'aggregate').mockResolvedValue([{
      adCount: 35,
      accounts: ['act_1', 'act_2'],
      campaigns: ['camp_1'],
    }] as any)
    jest.spyOn(MaterialMetrics, 'aggregate').mockResolvedValue([{
      totalSpend: 100,
      totalRevenue: 250,
      totalImpressions: 1000,
      totalClicks: 80,
      daysActive: 7,
    }] as any)

    const usage = await getMaterialUsage({ imageHash: 'hash_1' })

    expect(Creative.find).toHaveBeenCalledWith({ imageHash: 'hash_1' })
    expect(Ad.find).toHaveBeenCalledWith({ imageHash: 'hash_1' })
    expect(adFind.limit).toHaveBeenCalledWith(20)
    expect(MaterialMetrics.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      { $match: { imageHash: 'hash_1' } },
    ]))
    expect(JSON.stringify((MaterialMetrics.aggregate as jest.Mock).mock.calls[0][0])).not.toContain('adIds')
    expect(usage.usage).toMatchObject({
      creativeCount: 25,
      adCount: 35,
      accountCount: 2,
      campaignCount: 1,
    })
    expect(usage.performance.roas).toBe(2.5)
    expect(usage.ads).toHaveLength(20)
    expect(usage.limits).toMatchObject({
      ads: {
        total: 35,
        returned: 20,
        maxReturned: 20,
        truncated: true,
      },
      creatives: {
        total: 25,
        returned: 1,
        maxReturned: 20,
        truncated: true,
      },
    })
  })
})
