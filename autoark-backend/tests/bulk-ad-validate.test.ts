jest.mock('../src/config/redis', () => ({
  getRedisClient: jest.fn(() => ({})),
}))

jest.mock('../src/queue/bulkAd.queue', () => ({
  addBulkAdJobsBatch: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('../src/services/commercial.service', () => ({
  assertBulkAdPublishAllowed: jest.fn().mockResolvedValue(undefined),
}))

import AdDraft from '../src/models/AdDraft'
import AdTask from '../src/models/AdTask'
import CopywritingPackage from '../src/models/CopywritingPackage'
import CreativeGroup from '../src/models/CreativeGroup'
import FacebookUser from '../src/models/FacebookUser'
import FbToken from '../src/models/FbToken'
import TargetingPackage from '../src/models/TargetingPackage'
import Account from '../src/models/Account'
import User from '../src/models/User'
import { addBulkAdJobsBatch } from '../src/queue/bulkAd.queue'
import { publishDraft, validateDraft } from '../src/services/bulkAd.service'

const draftId = '665000000000000000000010'
const creativeGroupId = '665000000000000000000011'
const copywritingPackageId = '665000000000000000000012'
const targetingPackageId = '665000000000000000000013'
const tokenId = '665000000000000000000014'
const secondTokenId = '665000000000000000000015'

const queryWithLean = (value: any) => ({
  lean: jest.fn().mockResolvedValue(value),
})

const tokenQuery = (value: any) => ({
  select: jest.fn().mockReturnValue(queryWithLean(value)),
})

const accountQuery = (value: any) => ({
  select: jest.fn().mockReturnValue(queryWithLean(value)),
})

const populatedDraftQuery = (value: any) => {
  const query: any = {
    populate: jest.fn().mockReturnThis(),
    then: (resolve: any) => Promise.resolve(resolve(value)),
    catch: jest.fn(),
  }
  return query
}

const baseDraft = (overrides: any = {}) => ({
  _id: draftId,
  organizationId: '665000000000000000000001',
  createdBy: '665000000000000000000002',
  facebookTokenId: tokenId,
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
  if (!jest.isMockFunction(Account.findOne)) {
    jest.spyOn(Account, 'findOne').mockReturnValue(accountQuery({
      _id: '665000000000000000000016',
      accountId: '123',
      accountStatus: 1,
    }) as any)
  }
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
      tokenId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
    }]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(true)
    expect(validation.errors).toHaveLength(0)
    expect(FbToken.find).toHaveBeenCalledWith({
      _id: tokenId,
      organizationId: draft.organizationId,
      status: 'active',
      userId: draft.createdBy,
    })
  })

  it('pins a legacy draft to the one token that owns all selected assets', async () => {
    const draft = baseDraft({ facebookTokenId: undefined })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      tokenId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
    }]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(true)
    expect(draft.facebookTokenId).toBe(tokenId)
    expect(draft.save).toHaveBeenCalled()
  })

  it('pins a legacy draft to the only fully compatible token among multiple active tokens', async () => {
    const draft = baseDraft({ facebookTokenId: undefined })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([
      { _id: tokenId, fbUserId: 'fb_1' },
      { _id: secondTokenId, fbUserId: 'fb_2' },
    ]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([
      {
        fbUserId: 'fb_1',
        tokenId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [],
        pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
      },
      {
        fbUserId: 'fb_2',
        tokenId: secondTokenId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
        pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
      },
    ]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(true)
    expect(draft.facebookTokenId).toBe(secondTokenId)
    expect(draft.save).toHaveBeenCalled()
  })

  it('rejects a legacy draft whose account, Page, and Pixel are split across tokens', async () => {
    const draft = baseDraft({ facebookTokenId: undefined })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([
      { _id: tokenId, fbUserId: 'fb_1' },
      { _id: secondTokenId, fbUserId: 'fb_2' },
    ]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([
      {
        fbUserId: 'fb_1',
        tokenId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
        pixels: [],
      },
      {
        fbUserId: 'fb_2',
        tokenId: secondTokenId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [],
        pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
      },
    ]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'facebookAuthorization',
        message: expect.stringContaining('不属于同一个 Facebook 个人号授权'),
      }),
    ]))
    expect(draft.facebookTokenId).toBeUndefined()
    expect(draft.save).toHaveBeenCalled()
  })

  it('does not pin an inferred token when the legacy draft still fails validation', async () => {
    const draft = baseDraft({
      facebookTokenId: undefined,
      accounts: [{
        accountId: '123',
        accountName: 'Account 123',
        pixelId: 'pixel_1',
        conversionEvent: 'PURCHASE',
      }],
    })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([
      { _id: tokenId, fbUserId: 'fb_1' },
      { _id: secondTokenId, fbUserId: 'fb_2' },
    ]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([
      {
        fbUserId: 'fb_1',
        tokenId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [],
        pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
      },
      {
        fbUserId: 'fb_2',
        tokenId: secondTokenId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [],
        pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
      },
    ]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'accounts.123.pageId' }),
    ]))
    expect(draft.facebookTokenId).toBeUndefined()
    expect(draft.save).toHaveBeenCalled()
  })

  it('passes when one completed Facebook token can access both the account and a user-managed page', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(
      tokenQuery([
        {
          _id: tokenId,
          fbUserId: 'fb_1',
        },
      ]) as any,
    )
    jest.spyOn(FacebookUser, 'find').mockReturnValue(
      queryWithLean([
        {
          fbUserId: 'fb_1',
          tokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_123', status: 1 }],
          pages: [
            { pageId: 'page_1', accessToken: 'PAGE_TOKEN', accounts: [] },
          ],
          pixels: [
            { pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] },
          ],
        },
      ]) as any,
    )
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(true)
    expect(validation.errors).toHaveLength(0)
  })

  it('does not combine a user-managed page from one token with an account from another token', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(
      tokenQuery([
        { _id: tokenId, fbUserId: 'fb_1' },
        { _id: secondTokenId, fbUserId: 'fb_2' },
      ]) as any,
    )
    jest.spyOn(FacebookUser, 'find').mockReturnValue(
      queryWithLean([
        {
          fbUserId: 'fb_1',
          tokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_123', status: 1 }],
          pages: [],
          pixels: [
            { pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] },
          ],
        },
        {
          fbUserId: 'fb_2',
          tokenId: secondTokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_999', status: 1 }],
          pages: [
            { pageId: 'page_1', accessToken: 'PAGE_TOKEN', accounts: [] },
          ],
          pixels: [],
        },
      ]) as any,
    )
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toContain(
      'accounts.123.pageId',
    )
  })

  it('does not use a completed snapshot outside the draft active token scope', async () => {
    const draft = baseDraft({ organizationId: undefined })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(
      tokenQuery([
        {
          _id: tokenId,
          fbUserId: 'fb_1',
        },
      ]) as any,
    )
    jest.spyOn(FacebookUser, 'find').mockReturnValue(
      queryWithLean([
        {
          fbUserId: 'fb_1',
          tokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_123', status: 1 }],
          pages: [],
          pixels: [
            { pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] },
          ],
        },
        {
          fbUserId: 'fb_1',
          tokenId: secondTokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_123', status: 1 }],
          pages: [
            { pageId: 'page_1', accessToken: 'PAGE_TOKEN', accounts: [] },
          ],
          pixels: [],
        },
      ]) as any,
    )
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toContain(
      'accounts.123.pageId',
    )
  })

  it('rejects ambiguous duplicate cache rows instead of unioning their permissions', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
      organizationId: draft.organizationId,
    }]) as any)
    const facebookUserFind = jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([
      {
        fbUserId: 'fb_1',
        tokenId,
        organizationId: draft.organizationId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
        pixels: [],
      },
      {
        fbUserId: 'fb_1',
        tokenId,
        organizationId: draft.organizationId,
        syncStatus: 'completed',
        adAccounts: [{ accountId: 'act_123', status: 1 }],
        pages: [],
        pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
      },
    ]) as any)
    jest.spyOn(Account, 'findOne').mockReturnValue(accountQuery(null) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(facebookUserFind).toHaveBeenCalledWith({
      tokenId,
      organizationId: draft.organizationId,
      fbUserId: 'fb_1',
    })
    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'facebookAssets' }),
      expect.objectContaining({ field: 'accounts.123.access' }),
    ]))
  })

  it('does not use a user-managed page from a snapshot whose sync is incomplete', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(
      tokenQuery([
        { _id: tokenId, fbUserId: 'fb_1' },
        { _id: secondTokenId, fbUserId: 'fb_2' },
      ]) as any,
    )
    jest.spyOn(FacebookUser, 'find').mockReturnValue(
      queryWithLean([
        {
          fbUserId: 'fb_1',
          tokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_999', status: 1 }],
          pages: [],
          pixels: [],
        },
        {
          fbUserId: 'fb_2',
          tokenId: secondTokenId,
          syncStatus: 'syncing',
          adAccounts: [{ accountId: 'act_123', status: 1 }],
          pages: [
            { pageId: 'page_1', accessToken: 'PAGE_TOKEN', accounts: [] },
          ],
          pixels: [
            { pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] },
          ],
        },
      ]) as any,
    )
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toContain(
      'accounts.123.pageId',
    )
  })

  it('does not treat a blank page access token as user-managed Page permission', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(
      tokenQuery([
        {
          _id: tokenId,
          fbUserId: 'fb_1',
        },
      ]) as any,
    )
    jest.spyOn(FacebookUser, 'find').mockReturnValue(
      queryWithLean([
        {
          fbUserId: 'fb_1',
          tokenId,
          syncStatus: 'completed',
          adAccounts: [{ accountId: 'act_123', status: 1 }],
          pages: [{ pageId: 'page_1', accessToken: '   ', accounts: [] }],
          pixels: [
            { pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] },
          ],
        },
      ]) as any,
    )
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toContain(
      'accounts.123.pageId',
    )
  })

  it('blocks publish when attribution windows are outside supported values', async () => {
    const draft = baseDraft({
      adset: {
        targetingPackageId,
        multiplier: 1,
        optimizationGoal: 'OFFSITE_CONVERSIONS',
        attribution: {
          clickWindow: 365,
          viewWindow: 2,
          engagedViewWindow: 3,
        },
      },
    })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      tokenId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
    }]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toEqual(expect.arrayContaining([
      'adset.attribution.clickWindow',
      'adset.attribution.viewWindow',
      'adset.attribution.engagedViewWindow',
    ]))
    expect(draft.save).toHaveBeenCalled()
  })

  it('blocks publish when adset multiplier is not an integer', async () => {
    const draft = baseDraft({
      adset: {
        targetingPackageId,
        multiplier: 1.5,
        optimizationGoal: 'OFFSITE_CONVERSIONS',
      },
    })
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      tokenId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
    }]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'adset.multiplier',
        message: '广告组倍率必须是 1 到 10 之间的整数',
      }),
    ]))
    expect(draft.save).toHaveBeenCalled()
  })

  it('blocks publish when selected account is not accessible by the synced Facebook authorization', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      tokenId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: '999', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: '123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: '123' }] }],
    }]) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toContain('accounts.123.access')
    expect(validation.errors.map((error: any) => error.message).join(' ')).toContain('当前 Facebook 授权未同步到账户 Account 123 的访问权限')
  })

  it('blocks publish when selected account is not in the organization asset inventory before sync completes', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      tokenId,
      syncStatus: 'syncing',
      adAccounts: [],
      pages: [],
      pixels: [],
    }]) as any)
    jest.spyOn(Account, 'findOne').mockReturnValue(accountQuery(null) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors.map((error: any) => error.field)).toContain('accounts.123.access')
    expect(validation.errors.map((error: any) => error.message).join(' ')).toContain('未分配到当前组织或账户资产尚未同步完成')
    expect(Account.findOne).toHaveBeenCalledWith({
      $and: [
        { channel: 'facebook', accountId: { $in: ['123', 'act_123'] } },
        { organizationId: '665000000000000000000001' },
      ],
    })
  })

  it('blocks a Meta-accessible account that belongs to another AutoArk organization', async () => {
    const draft = baseDraft()
    jest.spyOn(AdDraft, 'findOne').mockResolvedValue(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: tokenId,
      fbUserId: 'fb_1',
      organizationId: draft.organizationId,
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_1',
      tokenId,
      organizationId: draft.organizationId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
    }]) as any)
    jest.spyOn(Account, 'findOne').mockReturnValue(accountQuery(null) as any)
    mockValidPackages()

    const validation = await validateDraft(draftId, {})

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'accounts.123.access',
        message: expect.stringContaining('未分配到当前组织'),
      }),
    ]))
    expect(Account.findOne).toHaveBeenCalledWith({
      $and: [
        { channel: 'facebook', accountId: { $in: ['123', 'act_123'] } },
        { organizationId: draft.organizationId },
      ],
    })
  })

  it('returns structured validation failure details when publishing an invalid draft directly', async () => {
    const draft = baseDraft({
      accounts: [{
        accountId: '123',
        accountName: 'Account 123',
      }],
    })
    jest.spyOn(AdDraft, 'findOne')
      .mockReturnValueOnce(populatedDraftQuery(draft) as any)
      .mockResolvedValueOnce(draft as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([]) as any)
    mockValidPackages()

    await expect(publishDraft(draftId, '665000000000000000000002', {}))
      .rejects
      .toMatchObject({
        code: 'DRAFT_VALIDATION_FAILED',
        statusCode: 422,
        details: expect.objectContaining({
          errorCount: expect.any(Number),
          firstError: expect.objectContaining({
            field: 'facebookAuthorization',
          }),
          errorFields: expect.arrayContaining([
            'facebookAuthorization',
            'accounts.123.pageId',
            'accounts.123.pixelId',
          ]),
        }),
      })
  })

  it('copies the token pinned during legacy draft validation into the published task snapshot', async () => {
    const draft = baseDraft({ facebookTokenId: undefined })
    jest.spyOn(AdDraft, 'findOne')
      .mockResolvedValueOnce(draft as any)
      .mockReturnValueOnce(populatedDraftQuery(draft) as any)
    jest.spyOn(FbToken, 'find').mockReturnValue(tokenQuery([{
      _id: secondTokenId,
      fbUserId: 'fb_2',
    }]) as any)
    jest.spyOn(FacebookUser, 'find').mockReturnValue(queryWithLean([{
      fbUserId: 'fb_2',
      tokenId: secondTokenId,
      syncStatus: 'completed',
      adAccounts: [{ accountId: 'act_123', status: 1 }],
      pages: [{ pageId: 'page_1', accounts: [{ accountId: 'act_123' }] }],
      pixels: [{ pixelId: 'pixel_1', accounts: [{ accountId: 'act_123' }] }],
    }]) as any)
    jest.spyOn(CopywritingPackage, 'findOne').mockResolvedValue({
      name: 'Copy Package',
    } as any)
    jest.spyOn(User, 'findById').mockReturnValue(queryWithLean({
      username: 'admin',
    }) as any)
    const taskSave = jest.spyOn(AdTask.prototype, 'save').mockImplementation(async function(this: any) {
      return this
    })
    mockValidPackages()

    const publisherUserId = '665000000000000000000099'
    const task: any = await publishDraft(draftId, publisherUserId, {})

    expect(draft.facebookTokenId).toBe(secondTokenId)
    expect(task.configSnapshot.facebookTokenId.toString()).toBe(secondTokenId)
    expect(task.configSnapshot.facebookTokenOwnerUserId.toString()).toBe(draft.createdBy)
    expect(task.createdBy.toString()).toBe(publisherUserId)
    expect(taskSave).toHaveBeenCalled()
    expect(addBulkAdJobsBatch).toHaveBeenCalledWith(
      task._id.toString(),
      ['123'],
    )
  })
})
