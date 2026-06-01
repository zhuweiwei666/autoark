import AdDraft from '../src/models/AdDraft'
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import TargetingPackage from '../src/models/TargetingPackage'
import { validateDraft } from '../src/services/bulkAd.service'

const draftId = '665000000000000000000010'
const creativeGroupId = '665000000000000000000011'
const copywritingPackageId = '665000000000000000000012'
const targetingPackageId = '665000000000000000000013'
const tokenId = '665000000000000000000014'

const queryWithLean = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const tokenQuery = (value: any) => ({
  select: jest.fn().mockReturnValue(queryWithLean(value)),
})

const baseDraft = (overrides: any = {}) => ({
  _id: draftId,
  organizationId: '665000000000000000000001',
  createdBy: '665000000000000000000002',
  accounts: [{
    accountId: '123',
    accountName: 'Account 123',
    pageId: 'page_1',
    pixelId: 'pixel_1',
    conversionEvent: 'PURCHASE',
  }],
  campaign: {
    nameTemplate: 'campaign_{accountName}',
    objective: 'OUTCOME_SALES',
    budgetOptimization: true,
    budget: 50,
  },
  adset: {
    targetingPackageId,
    multiplier: 1,
    optimizationGoal: 'OFFSITE_CONVERSIONS',
  },
  ad: {
    creativeGroupIds: [creativeGroupId],
    copywritingPackageIds: [copywritingPackageId],
  },
  publishStrategy: {
    schedule: 'IMMEDIATE',
  },
  save: jest.fn().mockResolvedValue(undefined),
  ...overrides,
})

const mockValidPackages = () => {
  jest.spyOn(TargetingPackage, 'findOne').mockResolvedValue({
    _id: targetingPackageId,
    name: 'US Broad',
    geoLocations: { countries: ['US'] },
  } as any)
  jest.spyOn(CreativeGroup, 'find').mockReturnValue(queryWithLean([{
    _id: creativeGroupId,
    name: 'Creative Group',
    materials: [{ type: 'image', url: 'https://example.com/image.jpg', status: 'uploaded' }],
  }]) as any)
  jest.spyOn(CopywritingPackage, 'find').mockReturnValue(queryWithLean([{
    _id: copywritingPackageId,
    name: 'Copy Package',
    links: { websiteUrl: 'https://example.com' },
    content: {
      primaryTexts: ['Primary text'],
      headlines: ['Headline'],
    },
  }]) as any)
}

describe('bulk ad draft validation preflight', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('blocks publish when authorization, page, and pixel prerequisites are missing', async () => {
    const draft = baseDraft({
      accounts: [{
        accountId: '123',
        accountName: 'Account 123',
      }],
    })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toEqual(expect.arrayContaining([
      'facebookAuthorization',
      'accounts.123.pageId',
      'accounts.123.pixelId',
    ]))
    expect(draft.save).toHaveBeenCalled()
  })

  it('passes when cached Facebook assets match selected account, page, and pixel', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      syncStatus: 'completed',
      adAccounts: [{ accountId: '123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: '123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: '123' }] }],
    }]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(true)
    expect(validation.errors).toHaveLength(0)
  })
})
