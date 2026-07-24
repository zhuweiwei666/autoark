import { Request, Response } from 'express'
import bulkAdService from '../services/bulkAd.service'
import TargetingPackage from '../models/TargetingPackage'
import CopywritingPackage from '../models/CopywritingPackage'
import CreativeGroup from '../models/CreativeGroup'
import {
  searchTargetingInterests,
  searchTargetingLocations,
  getPages,
  getInstagramAccounts,
  getPixels,
  getCustomConversions,
} from '../integration/facebook/bulkCreate.api'
import FbToken from '../models/FbToken'
import logger from '../utils/logger'
import * as oauthService from '../services/facebook.oauth.service'
import { facebookClient } from '../integration/facebook/facebookClient'
import { parseProductUrl } from '../services/productMapping.service'
import { UserRole } from '../models/User'
import mongoose from 'mongoose'
import FacebookApp from '../models/FacebookApp'
import Account from '../models/Account'
import FacebookUser from '../models/FacebookUser'
import * as facebookUserService from '../services/facebookUser.service'
import * as facebookAccountsService from '../services/facebook.accounts.service'
import { buildFacebookAssetDiagnostics } from '../services/facebookAssets.diagnostics.service'
import { writeAuditLog } from '../services/auditLog.service'
import { buildPublicOAuthReadiness } from '../utils/facebookAppReadiness'
import { sanitizeFacebookPages } from '../utils/facebookAssetSanitizer'
import {
  combineFilters,
  sanitizeScopedUpdate,
  scopedOwnerFilter,
  scopedTokenFilter,
} from '../utils/accessControl'
import { getAccountIdsForQuery, normalizeForStorage } from '../utils/accountId'
import {
  parseLimitedNumber,
  parsePagination,
  pickAllowedString,
  pickSafeQueryString,
} from '../utils/pagination'

/**
 * 获取资产过滤条件（文案包/定向包/创意组等）
 * - 超级管理员：看所有
 * - 组织管理员：看本组织 + 公共数据
 * - 普通成员：看自己创建的 + 公共数据
 */
const getAssetFilter = (req: Request): any => {
  return scopedOwnerFilter(req)
}

const getControlFilter = (req: Request): any => {
  if (req.user?.role !== UserRole.MEMBER) {
    return getAssetFilter(req)
  }

  return combineFilters(
    getAssetFilter(req),
    scopedOwnerFilter(req, { memberOwnOnly: true }),
  )
}

const getScopedActiveToken = (req: Request) => {
  return FbToken.findOne({ status: 'active', ...scopedTokenFilter(req) }).sort({ updatedAt: -1 })
}

const createHttpError = (message: string, statusCode: number) => {
  const error: any = new Error(message)
  error.statusCode = statusCode
  return error
}

const FACEBOOK_GRAPH_ID_PATTERN = /^[A-Za-z0-9_.-]+$/

const isSafeFacebookGraphId = (value: string) => FACEBOOK_GRAPH_ID_PATTERN.test(value)

const parseAccountIdParam = (value: any) => {
  const raw = Array.isArray(value) ? value[0] : value
  const safe = pickTrimmedString(raw, 80)
  const normalized = safe ? normalizeForStorage(safe) : ''
  return normalized && isSafeFacebookGraphId(normalized) ? normalized : ''
}

const parseFacebookPageIdParam = (value: any) => {
  const raw = Array.isArray(value) ? value[0] : value
  const safe = pickTrimmedString(raw, 80)
  return safe && isSafeFacebookGraphId(safe) ? safe : ''
}

const AUTH_FACEBOOK_ASSET_PAGE_LIMIT = 10
const AUTH_FACEBOOK_ASSET_PAGE_SIZE = 100
const BULK_AD_OAUTH_CODE_MAX_LENGTH = 2048
const BULK_AD_OAUTH_ERROR_MAX_LENGTH = 1000
const BULK_AD_OAUTH_STATE_MAX_LENGTH = 4096
const DRAFT_ACCOUNT_LIMIT = 100
const DRAFT_CONFIG_ID_LIMIT = 50
const DRAFT_TEMPLATE_MAX_LENGTH = 240
const DRAFT_TRACKING_TAGS_MAX_LENGTH = 1000
const DRAFT_BUDGET_MAX = 100_000_000
const DRAFT_INLINE_TARGETING_MAX_DEPTH = 6
const DRAFT_INLINE_TARGETING_MAX_KEYS = 250
const DRAFT_INLINE_TARGETING_MAX_ARRAY_ITEMS = 500
const TARGETING_INTEREST_SEARCH_TYPES = ['adinterest', 'adinterestsuggestion'] as const
const TARGETING_LOCATION_SEARCH_TYPES = ['adgeolocation'] as const
const TARGETING_SEARCH_QUERY_MAX_LENGTH = 120
const CREATIVE_GROUP_MATERIAL_LIMIT = 50
const CREATIVE_GROUP_TAG_LIMIT = 20
const CREATIVE_MATERIAL_TYPES = ['image', 'video'] as const
const CREATIVE_MATERIAL_STATUSES = ['pending', 'uploaded', 'failed'] as const
const CREATIVE_MATERIAL_SOURCES = ['manual', 'facebook_sync', 'url_import'] as const
const CREATIVE_GROUP_PLATFORMS = ['facebook', 'tiktok', 'google'] as const
const CREATIVE_GROUP_FORMATS = ['single', 'carousel', 'collection'] as const
const PLATFORMS = ['facebook', 'tiktok', 'google'] as const
const TARGETING_OPTIMIZATION_VALUES = ['none', 'expansion_all'] as const
const TARGETING_OPTIMIZATION_GOALS = ['OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH', 'LANDING_PAGE_VIEWS', 'APP_INSTALLS'] as const
const TARGETING_PLACEMENT_TYPES = ['automatic', 'manual'] as const
const TARGETING_PLATFORMS = ['facebook', 'instagram', 'messenger', 'audience_network'] as const
const TARGETING_DEVICE_PLATFORMS = ['mobile', 'desktop'] as const
const TARGETING_MOBILE_OS = ['iOS', 'Android', 'all'] as const
const TARGETING_MOBILE_DEVICES = ['iphone_all', 'ipad_all', 'ipod_all', 'android_smartphone', 'android_tablet', 'feature_phone'] as const
const COPYWRITING_CTA_VALUES = [
  'SHOP_NOW',
  'LEARN_MORE',
  'SIGN_UP',
  'DOWNLOAD',
  'GET_OFFER',
  'GET_QUOTE',
  'BOOK_NOW',
  'CONTACT_US',
  'SUBSCRIBE',
  'WATCH_MORE',
  'APPLY_NOW',
  'BUY_NOW',
  'ORDER_NOW',
  'SEE_MORE',
  'MESSAGE_PAGE',
  'WHATSAPP_MESSAGE',
  'CALL_NOW',
  'GET_DIRECTIONS',
  'NO_BUTTON',
] as const
const DRAFT_STATUS_VALUES = ['ACTIVE', 'PAUSED'] as const
const DRAFT_BUDGET_TYPES = ['DAILY', 'LIFETIME'] as const
const DRAFT_BUYING_TYPES = ['AUCTION', 'RESERVED'] as const
const DRAFT_CAMPAIGN_STATUSES = ['ACTIVE', 'PAUSED'] as const
const DRAFT_AD_FORMATS = ['SINGLE', 'CAROUSEL', 'COLLECTION'] as const
const DRAFT_PUBLISH_TARGETING_LEVELS = ['CAMPAIGN', 'ADSET'] as const
const DRAFT_PUBLISH_CREATIVE_LEVELS = ['ACCOUNT', 'CAMPAIGN', 'ADSET'] as const
const DRAFT_PUBLISH_COPYWRITING_MODES = ['SHARED', 'SEQUENTIAL'] as const
const DRAFT_PUBLISH_SCHEDULES = ['IMMEDIATE', 'SCHEDULED'] as const

const pickTrimmedString = (value: any, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, maxLength)
  return trimmed || undefined
}

const pickOAuthCallbackString = (value: any, maxLength: number): string | undefined => {
  if (Array.isArray(value)) return pickTrimmedString(value[0], maxLength)
  return pickTrimmedString(value, maxLength)
}

const pickNonNegativeNumber = (value: any, max: number, integer = true): number | undefined => {
  const next = Number(value)
  if (!Number.isFinite(next) || next < 0) return undefined
  const normalized = integer ? Math.floor(next) : next
  return Math.min(max, normalized)
}

const pickLimitedStringArray = (value: any, maxItems: number, maxLength: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const values = Array.from(new Set(value
    .map((item) => pickTrimmedString(item, maxLength))
    .filter(Boolean))) as string[]
  return values.length > 0 ? values.slice(0, maxItems) : undefined
}

const pickAllowedStringArray = (
  value: any,
  allowedValues: readonly string[],
  maxItems: number,
): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const values = Array.from(new Set(value
    .filter((item) => typeof item === 'string' && allowedValues.includes(item)))) as string[]
  return values.length > 0 ? values.slice(0, maxItems) : undefined
}

const pickObjectArray = <T>(
  value: any,
  maxItems: number,
  mapper: (item: any) => T | undefined,
): T[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const values = value.slice(0, maxItems).map(mapper).filter(Boolean) as T[]
  return values.length > 0 ? values : undefined
}

const pickBoolean = (value: any): boolean | undefined => (
  typeof value === 'boolean' ? value : undefined
)

const pickValidDate = (value: any): Date | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const pickObjectIdString = (value: any): string | undefined => {
  const id = pickTrimmedString(value, 64)
  return id && mongoose.Types.ObjectId.isValid(id) ? id : undefined
}

const hasOwnValue = (value: any) => value !== undefined

const assignString = (target: any, input: any, field: string, maxLength: number) => {
  const value = pickTrimmedString(input?.[field], maxLength)
  if (value) target[field] = value
}

const assignNumber = (target: any, input: any, field: string, max: number, integer = true) => {
  const value = pickNonNegativeNumber(input?.[field], max, integer)
  if (value !== undefined) target[field] = value
}

const assignBoolean = (target: any, input: any, field: string) => {
  const value = pickBoolean(input?.[field])
  if (value !== undefined) target[field] = value
}

const assignAllowedString = (
  target: any,
  input: any,
  field: string,
  allowedValues: readonly string[],
  fallback = '',
) => {
  if (typeof input?.[field] !== 'string') return
  const value = pickAllowedString(input[field], allowedValues, fallback)
  if (value) target[field] = value
}

const isSafeDraftJsonKey = (key: string) => (
  key !== '__proto__' &&
  key !== 'prototype' &&
  key !== 'constructor' &&
  !key.startsWith('$') &&
  !key.includes('.')
)

const sanitizeDraftJsonValue = (value: any, depth = 0): any => {
  if (value === null) return null
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    if (depth >= DRAFT_INLINE_TARGETING_MAX_DEPTH) return undefined
    const items = value
      .slice(0, DRAFT_INLINE_TARGETING_MAX_ARRAY_ITEMS)
      .map((item) => sanitizeDraftJsonValue(item, depth + 1))
      .filter((item) => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (typeof value === 'object') {
    if (depth >= DRAFT_INLINE_TARGETING_MAX_DEPTH) return undefined
    const entries = Object.entries(value)
      .filter(([key]) => isSafeDraftJsonKey(key))
      .slice(0, DRAFT_INLINE_TARGETING_MAX_KEYS)
      .map(([key, item]) => [key, sanitizeDraftJsonValue(item, depth + 1)] as const)
      .filter(([, item]) => item !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return undefined
}

const sanitizeTags = (value: any) => pickLimitedStringArray(value, CREATIVE_GROUP_TAG_LIMIT, 40)

const sanitizePlatformFields = (input: any, data: any) => {
  const accountId = parseAccountIdParam(input?.accountId)
  if (accountId) data.accountId = accountId
  if (typeof input?.platform === 'string') {
    data.platform = pickAllowedString(input.platform, PLATFORMS, 'facebook')
  }
}

const sanitizeTargetingEntity = (item: any, includePath = false) => {
  const id = pickTrimmedString(item?.id, 80)
  const name = pickTrimmedString(item?.name, 160)
  if (!id && !name) return undefined

  const entity: any = {}
  if (id) entity.id = id
  if (name) entity.name = name
  const audienceSize = pickNonNegativeNumber(item?.audienceSize, 10_000_000_000)
  if (audienceSize !== undefined) entity.audienceSize = audienceSize
  if (includePath) {
    const path = pickLimitedStringArray(item?.path, 8, 120)
    if (path) entity.path = path
  }
  return entity
}

const sanitizeTargetingGeoLocations = (input: any) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const geo: any = {}

  const countries = pickLimitedStringArray(input.countries, 250, 8)
  if (countries) geo.countries = countries

  const regions = pickObjectArray(input.regions, 250, (item) => {
    const key = pickTrimmedString(item?.key, 80)
    if (!key) return undefined
    return {
      key,
      ...(pickTrimmedString(item?.name, 160) && { name: pickTrimmedString(item.name, 160) }),
      ...(pickTrimmedString(item?.country, 8) && { country: pickTrimmedString(item.country, 8) }),
    }
  })
  if (regions) geo.regions = regions

  const cities = pickObjectArray(input.cities, 250, (item) => {
    const key = pickTrimmedString(item?.key, 80)
    if (!key) return undefined
    const city: any = { key }
    const radius = pickNonNegativeNumber(item?.radius, 80)
    if (radius !== undefined) city.radius = radius
    const name = pickTrimmedString(item?.name, 160)
    const region = pickTrimmedString(item?.region, 80)
    const country = pickTrimmedString(item?.country, 8)
    if (name) city.name = name
    if (region) city.region = region
    if (country) city.country = country
    return city
  })
  if (cities) geo.cities = cities

  const locationTypes = pickLimitedStringArray(input.locationTypes, 8, 40)
  if (locationTypes) geo.locationTypes = locationTypes

  return Object.keys(geo).length > 0 ? geo : undefined
}

const sanitizeTargetingPackageInput = (input: any, options: { requireName?: boolean } = {}) => {
  const data: any = {}
  const name = pickTrimmedString(input?.name, 120)
  if (name) {
    data.name = name
  } else if (options.requireName) {
    throw createHttpError('定向包名称必填', 400)
  }

  sanitizePlatformFields(input, data)

  const geoLocations = sanitizeTargetingGeoLocations(input?.geoLocations)
  if (geoLocations) data.geoLocations = geoLocations

  if (input?.demographics && typeof input.demographics === 'object' && !Array.isArray(input.demographics)) {
    const demographics: any = {}
    const ageMin = pickNonNegativeNumber(input.demographics.ageMin, 65)
    const ageMax = pickNonNegativeNumber(input.demographics.ageMax, 65)
    if (ageMin !== undefined) demographics.ageMin = Math.max(13, Math.min(65, ageMin))
    if (ageMax !== undefined) demographics.ageMax = Math.max(demographics.ageMin || 13, Math.min(65, ageMax))
    if (Array.isArray(input.demographics.genders)) {
      const genders = Array.from(new Set(input.demographics.genders
        .map((gender: any) => Number(gender))
        .filter((gender: number) => gender === 1 || gender === 2)))
      if (genders.length > 0) demographics.genders = genders
    }
    if (Object.keys(demographics).length > 0) data.demographics = demographics
  }

  const interests = pickObjectArray(input?.interests, 100, (item) => sanitizeTargetingEntity(item, true))
  if (interests) data.interests = interests
  const behaviors = pickObjectArray(input?.behaviors, 100, sanitizeTargetingEntity)
  if (behaviors) data.behaviors = behaviors
  const customAudiences = pickObjectArray(input?.customAudiences, 100, sanitizeTargetingEntity)
  if (customAudiences) data.customAudiences = customAudiences

  if (input?.exclusions && typeof input.exclusions === 'object' && !Array.isArray(input.exclusions)) {
    const exclusions: any = {}
    const excludedInterests = pickObjectArray(input.exclusions.interests, 100, sanitizeTargetingEntity)
    const excludedBehaviors = pickObjectArray(input.exclusions.behaviors, 100, sanitizeTargetingEntity)
    const excludedAudiences = pickLimitedStringArray(input.exclusions.customAudiences, 100, 80)
    const excludedLocations = pickObjectArray(input.exclusions.locations, 100, (item) => {
      const key = pickTrimmedString(item?.key, 80)
      if (!key) return undefined
      return {
        key,
        ...(pickTrimmedString(item?.name, 160) && { name: pickTrimmedString(item.name, 160) }),
        ...(pickTrimmedString(item?.type, 40) && { type: pickTrimmedString(item.type, 40) }),
      }
    })
    if (excludedInterests) exclusions.interests = excludedInterests
    if (excludedBehaviors) exclusions.behaviors = excludedBehaviors
    if (excludedAudiences) exclusions.customAudiences = excludedAudiences
    if (excludedLocations) exclusions.locations = excludedLocations
    if (Object.keys(exclusions).length > 0) data.exclusions = exclusions
  }

  if (typeof input?.targetingOptimization === 'string') {
    data.targetingOptimization = pickAllowedString(input.targetingOptimization, TARGETING_OPTIMIZATION_VALUES, 'none')
  }
  const targetingRelaxationTypes = pickLimitedStringArray(input?.targetingRelaxationTypes, 20, 80)
  if (targetingRelaxationTypes) data.targetingRelaxationTypes = targetingRelaxationTypes

  if (input?.placement && typeof input.placement === 'object' && !Array.isArray(input.placement)) {
    const placement: any = {}
    if (typeof input.placement.type === 'string') {
      placement.type = pickAllowedString(input.placement.type, TARGETING_PLACEMENT_TYPES, 'automatic')
    }
    const platforms = pickAllowedStringArray(input.placement.platforms, TARGETING_PLATFORMS, 8)
    const positions = pickLimitedStringArray(input.placement.positions, 80, 80)
    const devicePlatforms = pickAllowedStringArray(input.placement.devicePlatforms, TARGETING_DEVICE_PLATFORMS, 2)
    if (platforms) placement.platforms = platforms
    if (positions) placement.positions = positions
    if (devicePlatforms) placement.devicePlatforms = devicePlatforms
    if (Object.keys(placement).length > 0) data.placement = placement
  }

  if (input?.deviceSettings && typeof input.deviceSettings === 'object' && !Array.isArray(input.deviceSettings)) {
    const deviceSettings: any = {}
    const mobileOS = pickAllowedStringArray(input.deviceSettings.mobileOS, TARGETING_MOBILE_OS, 3)
    const mobileDevices = pickAllowedStringArray(input.deviceSettings.mobileDevices, TARGETING_MOBILE_DEVICES, 20)
    if (mobileOS) deviceSettings.mobileOS = mobileOS
    if (mobileDevices) deviceSettings.mobileDevices = mobileDevices
    ;['iosVersionMin', 'iosVersionMax', 'androidVersionMin', 'androidVersionMax'].forEach((field) => {
      const value = pickTrimmedString(input.deviceSettings[field], 24)
      if (value) deviceSettings[field] = value
    })
    const wifiOnly = pickBoolean(input.deviceSettings.wifiOnly)
    if (wifiOnly !== undefined) deviceSettings.wifiOnly = wifiOnly
    const excludedDevices = pickLimitedStringArray(input.deviceSettings.excludedDevices, 100, 120)
    if (excludedDevices) deviceSettings.excludedDevices = excludedDevices
    if (Object.keys(deviceSettings).length > 0) data.deviceSettings = deviceSettings
  }

  if (typeof input?.optimizationGoal === 'string') {
    data.optimizationGoal = pickAllowedString(input.optimizationGoal, TARGETING_OPTIMIZATION_GOALS, 'OFFSITE_CONVERSIONS')
  }

  if (input?.estimatedAudienceSize && typeof input.estimatedAudienceSize === 'object' && !Array.isArray(input.estimatedAudienceSize)) {
    const estimatedAudienceSize: any = {}
    const lower = pickNonNegativeNumber(input.estimatedAudienceSize.lower, 10_000_000_000)
    const upper = pickNonNegativeNumber(input.estimatedAudienceSize.upper, 10_000_000_000)
    if (lower !== undefined) estimatedAudienceSize.lower = lower
    if (upper !== undefined) estimatedAudienceSize.upper = upper
    if (Object.keys(estimatedAudienceSize).length > 0) data.estimatedAudienceSize = estimatedAudienceSize
  }

  const description = pickTrimmedString(input?.description, 1000)
  if (description) data.description = description
  const tags = sanitizeTags(input?.tags)
  if (tags) data.tags = tags

  return data
}

const sanitizeCopywritingPackageInput = (input: any, options: { requireName?: boolean } = {}) => {
  const data: any = {}
  const name = pickTrimmedString(input?.name, 120)
  if (name) {
    data.name = name
  } else if (options.requireName) {
    throw createHttpError('文案包名称必填', 400)
  }

  sanitizePlatformFields(input, data)

  if (input?.content && typeof input.content === 'object' && !Array.isArray(input.content)) {
    const content: any = {}
    const primaryTexts = pickLimitedStringArray(input.content.primaryTexts, 5, 500)
    const headlines = pickLimitedStringArray(input.content.headlines, 5, 255)
    const descriptions = pickLimitedStringArray(input.content.descriptions, 5, 255)
    if (primaryTexts) content.primaryTexts = primaryTexts
    if (headlines) content.headlines = headlines
    if (descriptions) content.descriptions = descriptions
    if (Object.keys(content).length > 0) data.content = content
  }

  if (typeof input?.callToAction === 'string') {
    data.callToAction = pickAllowedString(input.callToAction, COPYWRITING_CTA_VALUES, 'SHOP_NOW')
  }

  if (input?.links && typeof input.links === 'object' && !Array.isArray(input.links)) {
    const links: any = {}
    ;['websiteUrl', 'displayLink', 'deepLink'].forEach((field) => {
      const value = pickTrimmedString(input.links[field], 2048)
      if (value) links[field] = value
    })
    if (Object.keys(links).length > 0) data.links = links
  }

  if (input?.product && typeof input.product === 'object' && !Array.isArray(input.product)) {
    const product: any = {}
    ;['name', 'identifier', 'domain'].forEach((field) => {
      const value = pickTrimmedString(input.product[field], field === 'domain' ? 255 : 160)
      if (value) product[field] = value
    })
    const autoExtracted = pickBoolean(input.product.autoExtracted)
    if (autoExtracted !== undefined) product.autoExtracted = autoExtracted
    if (Object.keys(product).length > 0) data.product = product
  }

  if (input?.urlParameters && typeof input.urlParameters === 'object' && !Array.isArray(input.urlParameters)) {
    const urlParameters: any = {}
    ;['utmSource', 'utmMedium', 'utmCampaign', 'utmContent'].forEach((field) => {
      const value = pickTrimmedString(input.urlParameters[field], 160)
      if (value) urlParameters[field] = value
    })
    if (input.urlParameters.customParams && typeof input.urlParameters.customParams === 'object' && !Array.isArray(input.urlParameters.customParams)) {
      const customParams = Object.entries(input.urlParameters.customParams)
        .slice(0, 20)
        .reduce((acc: Record<string, string>, [key, value]) => {
          const safeKey = pickTrimmedString(key, 80)
          const safeValue = pickTrimmedString(value, 200)
          if (safeKey && safeValue) acc[safeKey] = safeValue
          return acc
        }, {})
      if (Object.keys(customParams).length > 0) urlParameters.customParams = customParams
    }
    if (Object.keys(urlParameters).length > 0) data.urlParameters = urlParameters
  }

  const description = pickTrimmedString(input?.description, 1000)
  if (description) data.description = description
  const language = pickTrimmedString(input?.language, 24)
  if (language) data.language = language
  const tags = sanitizeTags(input?.tags)
  if (tags) data.tags = tags

  return data
}

const sanitizeDraftWriteInput = (input: any) => {
  const data: any = {}
  const name = pickTrimmedString(input?.name, 160)
  if (name) data.name = name

  if (Array.isArray(input?.accounts)) {
    const accounts = input.accounts
      .slice(0, DRAFT_ACCOUNT_LIMIT)
      .map((account: any) => {
        const accountId = pickTrimmedString(account?.accountId, 80)
        if (!accountId) return undefined
        const item: any = { accountId }
        ;[
          ['accountName', 160],
          ['pageId', 80],
          ['pageName', 160],
          ['instagramAccountId', 80],
          ['pixelId', 80],
          ['pixelName', 160],
          ['domain', 255],
          ['conversionEvent', 80],
        ].forEach(([field, maxLength]) => assignString(item, account, field as string, maxLength as number))
        return item
      })
      .filter(Boolean)
    if (accounts.length > 0) data.accounts = accounts
  }

  if (input?.campaign && typeof input.campaign === 'object' && !Array.isArray(input.campaign)) {
    const campaign: any = {}
    assignString(campaign, input.campaign, 'nameTemplate', DRAFT_TEMPLATE_MAX_LENGTH)
    assignAllowedString(campaign, input.campaign, 'status', DRAFT_CAMPAIGN_STATUSES)
    assignString(campaign, input.campaign, 'objective', 80)
    assignAllowedString(campaign, input.campaign, 'buyingType', DRAFT_BUYING_TYPES)
    assignNumber(campaign, input.campaign, 'spendCap', DRAFT_BUDGET_MAX)
    assignBoolean(campaign, input.campaign, 'budgetOptimization')
    assignAllowedString(campaign, input.campaign, 'budgetType', DRAFT_BUDGET_TYPES)
    assignNumber(campaign, input.campaign, 'budget', DRAFT_BUDGET_MAX)
    assignString(campaign, input.campaign, 'bidStrategy', 80)
    assignNumber(campaign, input.campaign, 'bidAmount', DRAFT_BUDGET_MAX)
    const specialAdCategories = pickLimitedStringArray(input.campaign.specialAdCategories, 10, 80)
    if (specialAdCategories) campaign.specialAdCategories = specialAdCategories
    if (Object.keys(campaign).length > 0) data.campaign = campaign
  }

  if (input?.adset && typeof input.adset === 'object' && !Array.isArray(input.adset)) {
    const adset: any = {}
    assignString(adset, input.adset, 'nameTemplate', DRAFT_TEMPLATE_MAX_LENGTH)
    assignAllowedString(adset, input.adset, 'status', DRAFT_STATUS_VALUES)
    assignNumber(adset, input.adset, 'multiplier', 10)
    assignAllowedString(adset, input.adset, 'budgetType', DRAFT_BUDGET_TYPES)
    assignNumber(adset, input.adset, 'budget', DRAFT_BUDGET_MAX)
    const startTime = pickValidDate(input.adset.startTime)
    const endTime = pickValidDate(input.adset.endTime)
    if (startTime) adset.startTime = startTime
    if (endTime) adset.endTime = endTime
    assignString(adset, input.adset, 'optimizationGoal', 80)
    assignString(adset, input.adset, 'billingEvent', 80)
    assignString(adset, input.adset, 'bidStrategy', 80)
    assignNumber(adset, input.adset, 'bidAmount', DRAFT_BUDGET_MAX)
    assignNumber(adset, input.adset, 'costCap', DRAFT_BUDGET_MAX)
    assignAllowedString(adset, input.adset, 'pacingType', ['standard', 'no_pacing'])
    const targetingPackageId = pickObjectIdString(input.adset.targetingPackageId)
    if (targetingPackageId) adset.targetingPackageId = targetingPackageId
    const inlineTargeting = sanitizeDraftJsonValue(input.adset.inlineTargeting)
    if (inlineTargeting) adset.inlineTargeting = inlineTargeting
    ;['attribution', 'attributionSpec', 'placement', 'device'].forEach((field) => {
      const sanitized = sanitizeDraftJsonValue(input.adset[field])
      if (sanitized) adset[field] = sanitized
    })
    if (Object.keys(adset).length > 0) data.adset = adset
  }

  if (input?.ad && typeof input.ad === 'object' && !Array.isArray(input.ad)) {
    const ad: any = {}
    assignString(ad, input.ad, 'nameTemplate', DRAFT_TEMPLATE_MAX_LENGTH)
    assignAllowedString(ad, input.ad, 'status', DRAFT_STATUS_VALUES)
    assignAllowedString(ad, input.ad, 'format', DRAFT_AD_FORMATS)
    assignBoolean(ad, input.ad, 'dynamicCreative')
    if (input.ad.tracking && typeof input.ad.tracking === 'object' && !Array.isArray(input.ad.tracking)) {
      const tracking: any = {}
      assignBoolean(tracking, input.ad.tracking, 'websiteEvent')
      assignBoolean(tracking, input.ad.tracking, 'appEvent')
      assignString(tracking, input.ad.tracking, 'urlTags', DRAFT_TRACKING_TAGS_MAX_LENGTH)
      if (Object.keys(tracking).length > 0) ad.tracking = tracking
    }
    const creativeGroupIds = pickLimitedStringArray(input.ad.creativeGroupIds, DRAFT_CONFIG_ID_LIMIT, 64)
      ?.map((id) => pickObjectIdString(id))
      .filter(hasOwnValue)
    if (creativeGroupIds?.length) ad.creativeGroupIds = creativeGroupIds
    const copywritingPackageIds = pickLimitedStringArray(input.ad.copywritingPackageIds, DRAFT_CONFIG_ID_LIMIT, 64)
      ?.map((id) => pickObjectIdString(id))
      .filter(hasOwnValue)
    if (copywritingPackageIds?.length) ad.copywritingPackageIds = copywritingPackageIds
    if (Object.keys(ad).length > 0) data.ad = ad
  }

  if (input?.publishStrategy && typeof input.publishStrategy === 'object' && !Array.isArray(input.publishStrategy)) {
    const publishStrategy: any = {}
    assignAllowedString(publishStrategy, input.publishStrategy, 'targetingLevel', DRAFT_PUBLISH_TARGETING_LEVELS)
    assignAllowedString(publishStrategy, input.publishStrategy, 'creativeLevel', DRAFT_PUBLISH_CREATIVE_LEVELS)
    assignAllowedString(publishStrategy, input.publishStrategy, 'copywritingMode', DRAFT_PUBLISH_COPYWRITING_MODES)
    assignAllowedString(publishStrategy, input.publishStrategy, 'schedule', DRAFT_PUBLISH_SCHEDULES)
    const scheduledTime = pickValidDate(input.publishStrategy.scheduledTime)
    if (scheduledTime) publishStrategy.scheduledTime = scheduledTime
    if (Object.keys(publishStrategy).length > 0) {
      data.publishStrategy = publishStrategy
    }
  }

  const notes = pickTrimmedString(input?.notes, 2000)
  if (notes) data.notes = notes

  return data
}

const sanitizeCreativeMaterialInput = (input: any) => {
  const type = pickAllowedString(input?.type, CREATIVE_MATERIAL_TYPES, '')
  const url = pickTrimmedString(input?.url, 2048)

  if (!type || !url) {
    throw createHttpError('素材类型和 URL 必填', 400)
  }

  const material: any = { type, url }
  const stringFields: Array<[string, number]> = [
    ['name', 200],
    ['format', 24],
    ['thumbnail', 2048],
    ['facebookImageHash', 128],
    ['facebookVideoId', 128],
    ['sourceId', 128],
  ]

  stringFields.forEach(([field, maxLength]) => {
    const value = pickTrimmedString(input?.[field], maxLength)
    if (value) material[field] = value
  })

  const numberFields: Array<[string, number, boolean]> = [
    ['width', 100000, true],
    ['height', 100000, true],
    ['duration', 86400, false],
    ['size', 1024 * 1024 * 1024 * 20, true],
  ]
  numberFields.forEach(([field, max, integer]) => {
    const value = pickNonNegativeNumber(input?.[field], max, integer)
    if (value !== undefined) material[field] = value
  })

  if (typeof input?.status === 'string') {
    material.status = pickAllowedString(input.status, CREATIVE_MATERIAL_STATUSES, 'pending')
  }
  if (typeof input?.source === 'string') {
    material.source = pickAllowedString(input.source, CREATIVE_MATERIAL_SOURCES, 'manual')
  }
  if (input?.uploadedAt) {
    const uploadedAt = new Date(input.uploadedAt)
    if (!Number.isNaN(uploadedAt.getTime())) material.uploadedAt = uploadedAt
  }

  return material
}

const sanitizeCreativeGroupConfig = (input: any) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined

  const config: any = {}
  if (typeof input.format === 'string') {
    config.format = pickAllowedString(input.format, CREATIVE_GROUP_FORMATS, 'single')
  }
  if (typeof input.dynamicCreative === 'boolean') {
    config.dynamicCreative = input.dynamicCreative
  }
  if (input.carousel && typeof input.carousel === 'object' && !Array.isArray(input.carousel)) {
    config.carousel = {}
    if (typeof input.carousel.autoOptimize === 'boolean') {
      config.carousel.autoOptimize = input.carousel.autoOptimize
    }
    if (typeof input.carousel.linkPerCard === 'boolean') {
      config.carousel.linkPerCard = input.carousel.linkPerCard
    }
    if (Object.keys(config.carousel).length === 0) {
      delete config.carousel
    }
  }

  return Object.keys(config).length > 0 ? config : undefined
}

const sanitizeCreativeGroupInput = (input: any, options: { requireName?: boolean } = { requireName: true }) => {
  const name = pickTrimmedString(input?.name, 120)
  if (!name && options.requireName !== false) {
    throw createHttpError('创意组名称必填', 400)
  }

  const data: any = {}
  if (name) data.name = name

  const platform = pickAllowedString(input?.platform, CREATIVE_GROUP_PLATFORMS, '')
  if (platform) {
    data.platform = platform
  } else if (options.requireName !== false) {
    data.platform = 'facebook'
  }

  const accountId = parseAccountIdParam(input?.accountId)
  if (accountId) data.accountId = accountId

  if (Array.isArray(input?.materials)) {
    data.materials = input.materials
      .slice(0, CREATIVE_GROUP_MATERIAL_LIMIT)
      .map(sanitizeCreativeMaterialInput)
  }

  const config = sanitizeCreativeGroupConfig(input?.config)
  if (config) data.config = config

  const copywritingPackageId = pickTrimmedString(input?.copywritingPackageId, 64)
  if (copywritingPackageId && mongoose.Types.ObjectId.isValid(copywritingPackageId)) {
    data.copywritingPackageId = copywritingPackageId
  }

  const description = pickTrimmedString(input?.description, 1000)
  if (description) data.description = description

  const folderId = pickTrimmedString(input?.folderId, 120)
  if (folderId) data.folderId = folderId

  if (Array.isArray(input?.tags)) {
    const tags = Array.from(new Set(input.tags
      .map((tag: any) => pickTrimmedString(tag, 40))
      .filter(Boolean))) as string[]
    if (tags.length > 0) data.tags = tags.slice(0, CREATIVE_GROUP_TAG_LIMIT)
  }

  return data
}

const fetchFacebookAssetPages = async (
  endpoint: string,
  accessToken: string,
  fields: string,
) => {
  const items: any[] = []
  let after: string | undefined
  let pageCount = 0
  let truncated = false

  while (pageCount < AUTH_FACEBOOK_ASSET_PAGE_LIMIT) {
    const result = await facebookClient.get(endpoint, {
      access_token: accessToken,
      fields,
      limit: AUTH_FACEBOOK_ASSET_PAGE_SIZE,
      ...(after && { after }),
    })

    pageCount += 1
    items.push(...(result.data || []))

    after = result.paging?.cursors?.after
    if (!after || !result.paging?.next) {
      return { items, pageCount, truncated }
    }
  }

  truncated = Boolean(after)
  return { items, pageCount, truncated }
}

const fetchAuthAdAccountsPages = async (accessToken: string) => {
  const result = await fetchFacebookAssetPages(
    '/me/adaccounts',
    accessToken,
    'id,account_id,name,account_status,currency,timezone_name,amount_spent,balance',
  )
  return {
    accounts: result.items,
    pageCount: result.pageCount,
    truncated: result.truncated,
  }
}

const assertScopedFacebookAccountAccess = async (req: Request, rawAccountId: any) => {
  const accountId = parseAccountIdParam(rawAccountId)
  if (!accountId) {
    throw createHttpError('accountId is required', 400)
  }

  if (req.user?.role === UserRole.SUPER_ADMIN) {
    return accountId
  }

  const account = await Account.findOne(combineFilters(
    {
      channel: 'facebook',
      accountId: { $in: getAccountIdsForQuery([accountId]) },
    },
    getAssetFilter(req),
  ))
    .select('_id accountId')
    .lean()

  if (!account) {
    throw createHttpError(`无权访问广告账户 ${accountId}，请先同步并分配账户资产`, 403)
  }

  return accountId
}

const getScopedTokenForAccount = async (req: Request, rawAccountId: any) => {
  const accountId = await assertScopedFacebookAccountAccess(req, rawAccountId)
  const allTokens = await FbToken.find({ status: 'active', ...scopedTokenFilter(req) })

  const cachedTokenIds = allTokens
    .filter(token => token._id && token.fbUserId)
    .map(token => token._id)
    .filter(Boolean)
  if (cachedTokenIds.length > 0) {
    try {
      const cachedOwner = await FacebookUser.findOne({
        tokenId: { $in: cachedTokenIds },
        syncStatus: 'completed',
        'adAccounts.accountId': {
          $in: getAccountIdsForQuery([accountId]),
        },
      })
        .select('tokenId')
        .lean()
      const cachedToken = cachedOwner
        ? allTokens.find(token => String(token._id) === String(cachedOwner.tokenId))
        : undefined

      if (cachedToken?.fbUserId) {
        const facebookUserScope = {
          tokenId: String(cachedToken._id),
          organizationId: cachedToken.organizationId
            ? String(cachedToken.organizationId)
            : undefined,
        }
        logger.info(`[BulkAd] Found cached scoped token for account ${accountId}`)
        return {
          accountId,
          fbToken: cachedToken,
          facebookUserScope,
          cachedAccount: true,
        }
      }
    } catch (error: any) {
      logger.warn(
        `[BulkAd] Failed to read cached account ownership for ${accountId}: ${error.message}`,
      )
    }
  }

  for (const token of allTokens) {
    try {
      const account = await facebookClient.get(`/act_${accountId}`, {
        access_token: token.token,
        fields: 'id,name',
      })
      if (account?.id) {
        logger.info(`[BulkAd] Found scoped token for account ${accountId}`)
        return {
          accountId,
          fbToken: token,
          facebookUserScope: undefined,
          cachedAccount: false,
        }
      }
    } catch (error: any) {
      logger.debug(`[BulkAd] Scoped token candidate has no access to account ${accountId}`)
    }
  }

  throw createHttpError(`没有找到可访问账户 ${accountId} 的 Facebook Token`, 401)
}

const writeBulkAdAudit = (req: Request, input: {
  action: string
  status?: 'success' | 'failed' | 'warning'
  targetType?: string
  targetId?: string
  summary?: string
  reason?: string
  related?: any
  metadata?: any
  organizationId?: any
  userId?: any
}) => writeAuditLog(req, {
  category: 'bulk_ad',
  ...input,
  organizationId: input.organizationId || req.user?.organizationId,
  userId: input.userId || req.user?.userId,
})

const taskAuditMetadata = (task: any) => ({
  taskStatus: task?.status,
  accountCount: task?.progress?.totalAccounts || task?.items?.length || 0,
  successAccounts: task?.progress?.successAccounts || 0,
  failedAccounts: task?.progress?.failedAccounts || 0,
})

const validationAuditMetadata = (validation: any) => {
  const errors = Array.isArray(validation?.errors) ? validation.errors : []
  const warnings = Array.isArray(validation?.warnings) ? validation.warnings : []
  return {
    isValid: Boolean(validation?.isValid),
    errorCount: errors.length,
    warningCount: warnings.length,
    firstError: errors[0]?.message,
    firstErrorField: errors[0]?.field,
    errorFields: errors.map((error: any) => error.field).filter(Boolean).slice(0, 20),
    warningFields: warnings.map((warning: any) => warning.field).filter(Boolean).slice(0, 20),
  }
}

const parseBulkAdOAuthStateForAudit = (state: unknown): {
  autoarkUserId?: string
  organizationId?: string
  error?: string
} => {
  if (typeof state !== 'string') return {}

  try {
    const stateObj = oauthService.parseStateParamWithOptions(state, { requireSignature: true })
    const parts = String(stateObj.originalState || '').split('|')
    if (parts[0] === 'bulk-ad' && parts[1]) {
      return {
        autoarkUserId: parts[1],
        organizationId: parts[2] || undefined,
      }
    }
    return {}
  } catch (error: any) {
    return { error: error.message || 'Invalid OAuth state' }
  }
}

const buildPackageListFilter = (req: Request) => {
  const filter: any = { ...getAssetFilter(req) }
  const accountId = parseAccountIdParam(req.query.accountId)
  const platform = pickAllowedString(req.query.platform, PLATFORMS, '')

  if (accountId) filter.accountId = { $in: getAccountIdsForQuery([accountId]) }
  if (platform) filter.platform = platform

  return filter
}

// ==================== 草稿管理 ====================

/**
 * 创建广告草稿
 * POST /api/bulk-ad/drafts
 */
export const createDraft = async (req: Request, res: Response) => {
  try {
    const draftAccounts = Array.isArray(req.body.accounts) ? req.body.accounts : []
    const pixelCount = new Set(draftAccounts.map((account: any) => account?.pixelId).filter(Boolean)).size
    logger.info(`[BulkAd] createDraft received ${draftAccounts.length} account configs, ${pixelCount} pixels`)
    
    // 添加创建者信息
    const draftData = {
      ...sanitizeDraftWriteInput(req.body),
      createdBy: req.user?.userId,
      organizationId: req.user?.organizationId,
    }
    const draft = await bulkAdService.createDraft(draftData, req.user?.userId)
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Create draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新广告草稿
 * PUT /api/bulk-ad/drafts/:id
 */
export const updateDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.updateDraft(
      req.params.id,
      sanitizeScopedUpdate(sanitizeDraftWriteInput(req.body)),
      req.user?.userId,
      getControlFilter(req),
    )
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Update draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取草稿详情
 * GET /api/bulk-ad/drafts/:id
 */
export const getDraft = async (req: Request, res: Response) => {
  try {
    const draft = await bulkAdService.getDraft(req.params.id, getAssetFilter(req))
    res.json({ success: true, data: draft })
  } catch (error: any) {
    logger.error('[BulkAd] Get draft failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取草稿列表
 * GET /api/bulk-ad/drafts
 */
export const getDraftList = async (req: Request, res: Response) => {
  try {
    // 传递用户过滤条件
    const userFilter = getAssetFilter(req)
    const result = await bulkAdService.getDraftList(req.query, userFilter)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get draft list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除草稿
 * DELETE /api/bulk-ad/drafts/:id
 */
export const deleteDraft = async (req: Request, res: Response) => {
  try {
    await bulkAdService.deleteDraft(req.params.id, getControlFilter(req))
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete draft failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 验证草稿
 * POST /api/bulk-ad/drafts/:id/validate
 */
export const validateDraft = async (req: Request, res: Response) => {
  try {
    const validation = await bulkAdService.validateDraft(req.params.id, getAssetFilter(req))
    const firstError = validation.errors?.[0]
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.draft_validate',
      status: validation.isValid ? (validation.warnings?.length ? 'warning' : 'success') : 'failed',
      targetType: 'ad_draft',
      targetId: req.params.id,
      summary: validation.isValid ? '批量广告草稿预检通过' : '批量广告草稿预检未通过',
      reason: firstError?.message,
      metadata: validationAuditMetadata(validation),
    })
    res.json({ success: true, data: validation })
  } catch (error: any) {
    logger.error('[BulkAd] Validate draft failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.draft_validate',
      status: 'failed',
      targetType: 'ad_draft',
      targetId: req.params.id,
      summary: '批量广告草稿预检失败',
      reason: error.message,
      metadata: {
        errorCode: error.code,
        details: error.details,
      },
    })
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 发布草稿
 * POST /api/bulk-ad/drafts/:id/publish
 */
export const publishDraft = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.publishDraft(req.params.id, req.user?.userId, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.publish',
      targetType: 'ad_task',
      targetId: String(task._id),
      summary: `发布批量广告任务：${task.name || task._id}`,
      related: { draftId: req.params.id },
      metadata: taskAuditMetadata(task),
    })
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Publish draft failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.publish',
      status: 'failed',
      targetType: 'ad_draft',
      targetId: req.params.id,
      summary: '发布批量广告任务失败',
      reason: error.message,
      metadata: {
        errorCode: error.code,
        details: error.details,
      },
    })
    res.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      details: error.details,
    })
  }
}

// ==================== 任务管理 ====================

/**
 * 获取任务详情
 * GET /api/bulk-ad/tasks/:id
 */
export const getTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.getTask(req.params.id, getAssetFilter(req))
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Get task failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务运营诊断
 * GET /api/bulk-ad/tasks/:id/diagnostics
 */
export const getTaskDiagnostics = async (req: Request, res: Response) => {
  try {
    const diagnostics = await bulkAdService.getTaskDiagnostics(req.params.id, getAssetFilter(req))
    res.json({ success: true, data: diagnostics })
  } catch (error: any) {
    logger.error('[BulkAd] Get task diagnostics failed:', error)
    res.status(404).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务排障包
 * GET /api/bulk-ad/tasks/:id/support-package
 */
export const getTaskSupportPackage = async (req: Request, res: Response) => {
  try {
    const supportPackage = await bulkAdService.getTaskSupportPackage(req.params.id, getAssetFilter(req))
    const firstBucket = supportPackage.diagnostics?.buckets?.[0]
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.task_support_package.generate',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `生成任务排障包：${supportPackage.task?.name || req.params.id}`,
      metadata: {
        supportId: supportPackage.supportId,
        taskStatus: supportPackage.task?.status,
        health: supportPackage.diagnostics?.health,
        buildRef: supportPackage.system?.build?.ref,
        buildCommit: supportPackage.system?.build?.commit,
        buildShortCommit: supportPackage.system?.build?.shortCommit,
        buildDeployedAt: supportPackage.system?.build?.deployedAt,
        totalErrors: supportPackage.diagnostics?.summary?.totalErrors || 0,
        retryableErrors: supportPackage.diagnostics?.summary?.retryableErrors || 0,
        blockedErrors: supportPackage.diagnostics?.summary?.blockedErrors || 0,
        failedAccounts: supportPackage.diagnostics?.summary?.failedAccounts || 0,
        failedItemCount: supportPackage.limits?.failedItems?.total || supportPackage.failedItems?.length || 0,
        failedItemReturned: supportPackage.limits?.failedItems?.returned || supportPackage.failedItems?.length || 0,
        failedItemsTruncated: Boolean(supportPackage.limits?.failedItems?.truncated),
        topErrorCode: firstBucket?.errorCode,
      },
    })
    res.json({ success: true, data: supportPackage })
  } catch (error: any) {
    logger.error('[BulkAd] Get task support package failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.task_support_package.generate',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '生成任务排障包失败',
      reason: error.message,
    })
    res.status(error.message === 'Task not found' ? 404 : 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取任务列表
 * GET /api/bulk-ad/tasks
 */
export const getTaskList = async (req: Request, res: Response) => {
  try {
    // 传递用户过滤条件
    const userFilter = getAssetFilter(req)
    const result = await bulkAdService.getTaskList(req.query, userFilter)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get task list failed:', error)
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      message: error.message,
      code: error.code,
    })
  }
}

/**
 * 取消任务
 * POST /api/bulk-ad/tasks/:id/cancel
 */
export const cancelTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.cancelTask(req.params.id, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.cancel',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `取消批量广告任务：${task.name || req.params.id}`,
      metadata: taskAuditMetadata(task),
    })
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Cancel task failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.cancel',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '取消批量广告任务失败',
      reason: error.message,
    })
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 重试失败的任务项
 * POST /api/bulk-ad/tasks/:id/retry
 */
export const retryTask = async (req: Request, res: Response) => {
  try {
    const task = await bulkAdService.retryFailedItems(req.params.id, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.retry',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `重试失败任务项：${task.name || req.params.id}`,
      metadata: taskAuditMetadata(task),
    })
    res.json({ success: true, data: task })
  } catch (error: any) {
    logger.error('[BulkAd] Retry task failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.retry',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '重试批量广告任务失败',
      reason: error.message,
    })
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 重新执行任务（基于原任务配置创建新任务）
 * POST /api/bulk-ad/tasks/:id/rerun
 * @body multiplier 执行倍率（可选，默认1，最大20）
 */
export const rerunTask = async (req: Request, res: Response) => {
  try {
    const multiplier = parseInt(req.body.multiplier) || 1
    const userId = req.user?.userId
    const newTasks = await bulkAdService.rerunTask(req.params.id, multiplier, userId, getControlFilter(req))
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.rerun',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: `重新执行批量广告任务：${req.params.id}`,
      related: {
        newTaskIds: newTasks.map((task: any) => String(task._id)),
      },
      metadata: {
        multiplier,
        createdTaskCount: newTasks.length,
      },
    })
    res.json({ success: true, data: newTasks })
  } catch (error: any) {
    logger.error('[BulkAd] Rerun task failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.rerun',
      status: 'failed',
      targetType: 'ad_task',
      targetId: req.params.id,
      summary: '重新执行批量广告任务失败',
      reason: error.message,
      metadata: {
        multiplier: req.body.multiplier,
        errorCode: error.code,
        details: error.details,
      },
    })
    res.status(error.statusCode || 400).json({
      success: false,
      error: error.message,
      errorCode: error.code,
      details: error.details,
    })
  }
}

// ==================== 定向包管理 ====================

/**
 * 创建定向包
 * POST /api/bulk-ad/targeting-packages
 */
export const createTargetingPackage = async (req: Request, res: Response) => {
  try {
    const data = { 
      ...sanitizeTargetingPackageInput(req.body, { requireName: true }),
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId, // 记录创建者
    }
    const pkg = new TargetingPackage(data)
    await pkg.save()
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Create targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新定向包
 * PUT /api/bulk-ad/targeting-packages/:id
 */
export const updateTargetingPackage = async (req: Request, res: Response) => {
  try {
    const data = sanitizeTargetingPackageInput(req.body)
    const pkg = await TargetingPackage.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getControlFilter(req)),
      sanitizeScopedUpdate(data),
      { new: true }
    )
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Targeting package not found' })
    }
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Update targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取定向包列表
 * GET /api/bulk-ad/targeting-packages
 */
export const getTargetingPackageList = async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 使用更严格的用户级别过滤
    const filter = buildPackageListFilter(req)
    
    const [list, total] = await Promise.all([
      TargetingPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      TargetingPackage.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page, pageSize } })
  } catch (error: any) {
    logger.error('[BulkAd] Get targeting package list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除定向包
 * DELETE /api/bulk-ad/targeting-packages/:id
 */
export const deleteTargetingPackage = async (req: Request, res: Response) => {
  try {
    const result = await TargetingPackage.deleteOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Targeting package not found' })
    }
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete targeting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== 文案包管理 ====================

/**
 * 创建文案包
 * POST /api/bulk-ad/copywriting-packages
 */
export const createCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const data = { 
      ...sanitizeCopywritingPackageInput(req.body, { requireName: true }),
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId, // 记录创建者
    }
    
    // 自动从 websiteUrl 提取产品信息
    if (data.links?.websiteUrl && !data.product?.name) {
      const parsed = parseProductUrl(data.links.websiteUrl)
      if (parsed) {
        data.product = {
          name: parsed.productName || parsed.domain,
          identifier: parsed.productIdentifier,
          domain: parsed.domain,
          autoExtracted: true,
        }
        logger.info('[BulkAd] Auto-extracted product metadata for copywriting package')
      }
    }
    
    const pkg = new CopywritingPackage(data)
    await pkg.save()
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Create copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新文案包
 * PUT /api/bulk-ad/copywriting-packages/:id
 */
export const updateCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const data = sanitizeCopywritingPackageInput(req.body)
    
    // 如果更新了 websiteUrl，自动重新提取产品信息
    if (data.links?.websiteUrl) {
      const existingPkg = await CopywritingPackage.findOne(
        combineFilters({ _id: req.params.id }, getControlFilter(req)),
      )
      const urlChanged = existingPkg?.links?.websiteUrl !== data.links.websiteUrl
      const productNotManual = !existingPkg?.product || existingPkg.product.autoExtracted !== false
      
      if (urlChanged && productNotManual) {
        const parsed = parseProductUrl(data.links.websiteUrl)
        if (parsed) {
          data.product = {
            name: parsed.productName || parsed.domain,
            identifier: parsed.productIdentifier,
            domain: parsed.domain,
            autoExtracted: true,
          }
          logger.info('[BulkAd] Auto-updated product metadata for copywriting package')
        }
      }
    }
    
    const pkg = await CopywritingPackage.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getControlFilter(req)),
      sanitizeScopedUpdate(data),
      { new: true }
    )
    if (!pkg) {
      return res.status(404).json({ success: false, error: 'Copywriting package not found' })
    }
    res.json({ success: true, data: pkg })
  } catch (error: any) {
    logger.error('[BulkAd] Update copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取文案包列表
 * GET /api/bulk-ad/copywriting-packages
 */
export const getCopywritingPackageList = async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 使用更严格的用户级别过滤
    const filter = buildPackageListFilter(req)
    
    const [list, total] = await Promise.all([
      CopywritingPackage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      CopywritingPackage.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page, pageSize } })
  } catch (error: any) {
    logger.error('[BulkAd] Get copywriting package list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除文案包
 * DELETE /api/bulk-ad/copywriting-packages/:id
 */
export const deleteCopywritingPackage = async (req: Request, res: Response) => {
  try {
    const result = await CopywritingPackage.deleteOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Copywriting package not found' })
    }
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete copywriting package failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 批量解析所有文案包的产品信息
 * POST /api/bulk-ad/copywriting-packages/parse-products
 */
export const parseAllCopywritingProducts = async (req: Request, res: Response) => {
  try {
    const packages = await CopywritingPackage.find(combineFilters(getControlFilter(req), {
      'links.websiteUrl': { $exists: true, $ne: '' },
      $or: [
        { 'product.name': { $exists: false } },
        { 'product.name': '' },
        { 'product.name': null },
      ]
    }))
    
    let updated = 0
    let failed = 0
    const results: Array<{ id: string; name: string; productName?: string; error?: string }> = []
    
    for (const pkg of packages) {
      try {
        const urlString = pkg.links?.websiteUrl
        if (!urlString) continue
        
        const parsed = parseProductUrl(urlString)
        if (parsed) {
          pkg.product = {
            name: parsed.productName || parsed.domain,
            identifier: parsed.productIdentifier,
            domain: parsed.domain,
            autoExtracted: true,
          }
          await pkg.save()
          updated++
          results.push({ id: pkg._id.toString(), name: pkg.name, productName: parsed.productName })
        }
      } catch (error: any) {
        failed++
        results.push({ id: pkg._id.toString(), name: pkg.name, error: error.message })
      }
    }
    
    res.json({ 
      success: true, 
      data: { 
        total: packages.length,
        updated, 
        failed,
        results 
      } 
    })
  } catch (error: any) {
    logger.error('[BulkAd] Parse all copywriting products failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 创意组管理 ====================

/**
 * 创建创意组
 * POST /api/bulk-ad/creative-groups
 */
export const createCreativeGroup = async (req: Request, res: Response) => {
  try {
    const data = { 
      ...sanitizeCreativeGroupInput(req.body),
      organizationId: req.user?.organizationId,
      createdBy: req.user?.userId, // 记录创建者
    }
    const group = new CreativeGroup(data)
    await group.save()
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Create creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 更新创意组
 * PUT /api/bulk-ad/creative-groups/:id
 */
export const updateCreativeGroup = async (req: Request, res: Response) => {
  try {
    const group = await CreativeGroup.findOneAndUpdate(
      combineFilters({ _id: req.params.id }, getControlFilter(req)),
      sanitizeScopedUpdate(sanitizeCreativeGroupInput(req.body, { requireName: false })),
      { new: true }
    )
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Update creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 获取创意组列表
 * GET /api/bulk-ad/creative-groups
 */
export const getCreativeGroupList = async (req: Request, res: Response) => {
  try {
    const { page, pageSize, skip } = parsePagination(req.query)
    
    // 使用更严格的用户级别过滤
    const filter = buildPackageListFilter(req)
    
    const [list, total] = await Promise.all([
      CreativeGroup.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      CreativeGroup.countDocuments(filter),
    ])
    
    res.json({ success: true, data: { list, total, page, pageSize } })
  } catch (error: any) {
    logger.error('[BulkAd] Get creative group list failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 删除创意组
 * DELETE /api/bulk-ad/creative-groups/:id
 */
export const deleteCreativeGroup = async (req: Request, res: Response) => {
  try {
    const result = await CreativeGroup.deleteOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    res.json({ success: true })
  } catch (error: any) {
    logger.error('[BulkAd] Delete creative group failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 添加素材到创意组
 * POST /api/bulk-ad/creative-groups/:id/materials
 */
export const addMaterial = async (req: Request, res: Response) => {
  try {
    const group = await CreativeGroup.findOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    group.materials.push(sanitizeCreativeMaterialInput(req.body))
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Add material failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

/**
 * 删除创意组中的素材
 * DELETE /api/bulk-ad/creative-groups/:id/materials/:materialId
 */
export const removeMaterial = async (req: Request, res: Response) => {
  try {
    const group: any = await CreativeGroup.findOne(combineFilters({ _id: req.params.id }, getControlFilter(req)))
    if (!group) {
      return res.status(404).json({ success: false, error: 'Creative group not found' })
    }
    
    group.materials = group.materials.filter(
      (m: any) => m._id.toString() !== req.params.materialId
    )
    await group.save()
    
    res.json({ success: true, data: group })
  } catch (error: any) {
    logger.error('[BulkAd] Remove material failed:', error)
    res.status(400).json({ success: false, error: error.message })
  }
}

// ==================== Facebook 搜索 API ====================

/**
 * 搜索兴趣标签
 * GET /api/bulk-ad/search/interests
 */
export const searchInterests = async (req: Request, res: Response) => {
  try {
    const { q, type = 'adinterest', limit = 50 } = req.query
    const query = pickSafeQueryString(q, TARGETING_SEARCH_QUERY_MAX_LENGTH)
    if (!query) {
      return res.status(400).json({ success: false, error: 'q parameter is required' })
    }
    
    const fbToken = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await searchTargetingInterests({
      token: fbToken.token,
      query,
      type: pickAllowedString(type, TARGETING_INTEREST_SEARCH_TYPES, 'adinterest'),
      limit: parseLimitedNumber(limit, 50, 100),
    })
    
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Search interests failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 搜索地理位置
 * GET /api/bulk-ad/search/locations
 */
export const searchLocations = async (req: Request, res: Response) => {
  try {
    const { q, type = 'adgeolocation', limit = 50 } = req.query
    const query = pickSafeQueryString(q, TARGETING_SEARCH_QUERY_MAX_LENGTH)
    if (!query) {
      return res.status(400).json({ success: false, error: 'q parameter is required' })
    }
    
    const fbToken = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await searchTargetingLocations({
      token: fbToken.token,
      query,
      type: pickAllowedString(type, TARGETING_LOCATION_SEARCH_TYPES, 'adgeolocation'),
      limit: parseLimitedNumber(limit, 50, 100),
    })
    
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Search locations failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Facebook Pages
 * GET /api/bulk-ad/facebook/pages
 */
export const getFacebookPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    const result = await getPages(scopedAccountId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Facebook pages failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Instagram 账户
 * GET /api/bulk-ad/facebook/instagram-accounts
 */
export const getFacebookInstagramAccounts = async (req: Request, res: Response) => {
  try {
    const pageId = parseFacebookPageIdParam(req.query.pageId)
    if (!pageId) {
      return res.status(400).json({ success: false, error: 'pageId is required' })
    }
    
    const fbToken = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(400).json({ success: false, error: 'No active Facebook token' })
    }
    
    const result = await getInstagramAccounts(pageId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Instagram accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Pixels
 * GET /api/bulk-ad/facebook/pixels
 */
export const getFacebookPixels = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    const result = await getPixels(scopedAccountId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get Facebook pixels failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取自定义转化事件
 * GET /api/bulk-ad/facebook/custom-conversions
 */
export const getFacebookCustomConversions = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    const result = await getCustomConversions(scopedAccountId, fbToken.token)
    res.json({ success: true, data: result.data })
  } catch (error: any) {
    logger.error('[BulkAd] Get custom conversions failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

// ==================== 独立 OAuth 授权 ====================

/**
 * 获取可用的 Facebook Apps 列表
 * GET /api/bulk-ad/auth/apps
 */
export const getAvailableApps = async (req: Request, res: Response) => {
  try {
    const apps = await oauthService.getAvailableApps()
    res.json({ success: true, data: apps })
  } catch (error: any) {
    logger.error('[BulkAd] Get available apps failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Facebook 登录 URL（批量广告专用）
 * GET /api/bulk-ad/auth/login-url
 * 
 * 用户隔离：用户创建的 App 就是他要用的 App
 * 如果用户没有创建过 App，提示去 App 管理页面添加
 */
export const getAuthLoginUrl = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }
    
    // ⚠️ 登录链接必须每次实时生成：禁止任何缓存/304（浏览器/代理可能会缓存）
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    // 让 ETag 每次不同，避免命中 If-None-Match -> 304
    res.setHeader('ETag', `W/"bulkad-login-${Date.now()}-${Math.random().toString(16).slice(2)}"`)
    
    // 批量广告 OAuth：默认使用“系统 App 池”生成登录链接（避免用户自建 App 被 Facebook 临时禁用导致无法登录）
    // 如需强制使用用户自建 App，可传参：?useUserApp=true
    let appId: string | undefined
    const useUserApp = String(req.query.useUserApp || '').toLowerCase() === 'true'
    if (useUserApp) {
      const hasGlobalBusinessLoginConfig = Boolean(
        process.env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID || process.env.FACEBOOK_CONFIG_ID,
      )
      const userApp = await FacebookApp.findOne({
        createdBy: req.user.userId,
        status: 'active',
        'validation.isValid': true,
        'config.enabledForBulkAds': { $ne: false },
        'compliance.publicOauthReady': true,
        'compliance.appMode': 'live',
        'compliance.businessVerification': 'verified',
        'compliance.appReview': 'approved',
        ...(!hasGlobalBusinessLoginConfig ? {
          'config.businessLoginConfigId': { $exists: true, $nin: ['', null] },
        } : {}),
      }).sort({ createdAt: -1 })
      if (userApp?.appId) {
        appId = userApp.appId
        logger.info(`[BulkAd] OAuth using user's App (forced): ${userApp.appName} (${appId})`)
      } else {
        logger.warn(`[BulkAd] OAuth requested user's App but none valid; falling back to default App pool`)
      }
    } else {
      logger.info(`[BulkAd] OAuth using default App pool (useUserApp=false)`)
    }
    
    // 将 AutoArk 用户 ID 编码到 state 参数中
    // 格式: bulk-ad|userId|organizationId
    const orgId = req.user.organizationId ? String(req.user.organizationId) : ''
    const stateData = `bulk-ad|${req.user.userId}|${orgId}`
    const redirectUri = oauthService.getFacebookBulkAdRedirectUri()
    const loginUrl = await oauthService.getFacebookLoginUrl(stateData, appId, {
      businessLogin: true,
      redirectUri,
    })
    
    // 解析 client_id（便于排查 Facebook Login “功能不可用”属于哪个 App）
    let clientIdInUrl: string | null = null
    let configIdInUrl: string | null = null
    let scopeInUrl: string | null = null
    try {
      const parsedLoginUrl = new URL(loginUrl)
      clientIdInUrl = parsedLoginUrl.searchParams.get('client_id')
      configIdInUrl = parsedLoginUrl.searchParams.get('config_id')
      scopeInUrl = parsedLoginUrl.searchParams.get('scope')
    } catch {}
    const authorizationMode = configIdInUrl ? 'business_login' : 'scope_oauth'
    const diagnostics: string[] = []
    const addDiagnostic = (message: string) => {
      if (!diagnostics.includes(message)) diagnostics.push(message)
    }
    if (!configIdInUrl) {
      addDiagnostic('未使用 Facebook Login for Business config_id，当前为 scope OAuth 兜底模式。')
    }
    if (!clientIdInUrl) {
      addDiagnostic('登录链接中未解析到 client_id，请检查 Facebook App 配置。')
    }
    let publicOauthReady: boolean | undefined
    let publicOauthGapCodes: string[] = []
    let publicOauthGapCount = 0
    if (clientIdInUrl) {
      const selectedApp: any = await FacebookApp.findOne({ appId: clientIdInUrl })
      if (selectedApp) {
        const readiness = buildPublicOAuthReadiness(selectedApp)
        publicOauthReady = readiness.ready
        publicOauthGapCodes = readiness.gaps.map((gap) => gap.code)
        publicOauthGapCount = readiness.gaps.length
        if (!readiness.ready) {
          readiness.gaps.slice(0, 4).forEach((gap) => {
            addDiagnostic(`${gap.label}：${gap.detail}`)
          })
          if (readiness.gaps.length > 4) {
            addDiagnostic(`当前 Facebook App 还有 ${readiness.gaps.length - 4} 项 Public OAuth 缺口，请到 App 管理页查看完整诊断。`)
          }
        }
      } else {
        addDiagnostic('未在 App 管理中找到登录链接使用的 client_id，请检查 Facebook App 池配置。')
      }
    }
    
    logger.info(
      `[BulkAd] Generated login URL for user ${req.user.userId}, App: ${appId || 'default-pool'}, client_id: ${
        clientIdInUrl || 'unknown'
      }, mode: ${authorizationMode}`,
    )

    await writeBulkAdAudit(req, {
      action: 'bulk_ad.facebook_login_url',
      targetType: 'facebook_app',
      targetId: clientIdInUrl || appId || 'default-pool',
      summary: `生成 Facebook 授权链接：${authorizationMode === 'business_login' ? 'Business Login' : 'Scope OAuth'}`,
      metadata: {
        clientId: clientIdInUrl,
        redirectUri,
        authorizationMode,
        businessLoginConfigured: Boolean(configIdInUrl),
        scopeFallback: Boolean(scopeInUrl),
        publicOauthReady,
        publicOauthGapCount,
        publicOauthGapCodes,
        usingDefaultApp: !appId,
        diagnostics,
      },
    })
    
    res.json({
      success: true,
      data: {
        loginUrl,
        usingDefaultApp: !appId,
        clientId: clientIdInUrl,
        redirectUri,
        authorizationMode,
        businessLoginConfigured: Boolean(configIdInUrl),
        scopeFallback: Boolean(scopeInUrl),
        publicOauthReady,
        publicOauthGapCount,
        publicOauthGapCodes,
        diagnostics,
        serverTime: new Date().toISOString(),
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get login URL failed:', error)
    if (req.user) {
      await writeBulkAdAudit(req, {
        action: 'bulk_ad.facebook_login_url',
        status: 'failed',
        targetType: 'facebook_app',
        summary: '生成 Facebook 授权链接失败',
        reason: error.message,
      })
    }
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * OAuth 回调处理（批量广告专用）
 * GET /api/bulk-ad/auth/callback
 * 
 * 用户隔离：从 state 参数解析 AutoArk 用户 ID，并将 token 与该用户关联
 */
export const handleAuthCallback = async (req: Request, res: Response) => {
  let stateAudit: ReturnType<typeof parseBulkAdOAuthStateForAudit> = {}
  try {
    const code = pickOAuthCallbackString(req.query.code, BULK_AD_OAUTH_CODE_MAX_LENGTH)
    const error = pickOAuthCallbackString(req.query.error, BULK_AD_OAUTH_ERROR_MAX_LENGTH)
    const errorDescription = pickOAuthCallbackString(req.query.error_description, BULK_AD_OAUTH_ERROR_MAX_LENGTH)
    const state = pickOAuthCallbackString(req.query.state, BULK_AD_OAUTH_STATE_MAX_LENGTH)
    stateAudit = parseBulkAdOAuthStateForAudit(state)
    
    if (error) {
      logger.error('[BulkAd OAuth] Facebook returned error:', { error, errorDescription })
      await writeAuditLog(req, {
        category: 'bulk_ad',
        action: 'bulk_ad.facebook_oauth_callback',
        status: 'failed',
        userId: stateAudit.autoarkUserId,
        organizationId: stateAudit.organizationId,
        targetType: 'facebook_oauth',
        summary: 'Facebook 授权回调失败',
        reason: errorDescription || error,
        metadata: {
          facebookError: error,
          facebookErrorDescription: errorDescription,
          stateParseError: stateAudit.error,
        },
      })
      return res.redirect(
        `/oauth/callback?oauth_error=${encodeURIComponent(errorDescription || error)}`
      )
    }
    
    if (!code) {
      await writeAuditLog(req, {
        category: 'bulk_ad',
        action: 'bulk_ad.facebook_oauth_callback',
        status: 'failed',
        userId: stateAudit.autoarkUserId,
        organizationId: stateAudit.organizationId,
        targetType: 'facebook_oauth',
        summary: 'Facebook 授权回调缺少 code',
        reason: 'No authorization code received',
        metadata: {
          stateParseError: stateAudit.error,
        },
      })
      return res.redirect('/oauth/callback?oauth_error=No authorization code received')
    }
    
    // 解析 state 参数获取 AutoArk 用户信息。
    // 批量广告授权必须携带服务端 HMAC 签名 state，防止 token 被写成未绑定用户/组织的全局授权。
    let autoarkUserId: string | undefined
    let organizationId: string | undefined
    try {
      if (!state) {
        throw new Error('Missing OAuth state')
      }
      const stateObj = oauthService.parseStateParamWithOptions(state, { requireSignature: true })
      const originalState = stateObj.originalState || ''
      const parts = originalState.split('|')
      if (parts[0] !== 'bulk-ad' || !parts[1]) {
        throw new Error('Invalid OAuth state')
      }
      autoarkUserId = parts[1]
      organizationId = parts[2] || undefined
      logger.info(`[BulkAd OAuth] Binding token to AutoArk user: ${autoarkUserId}`)
    } catch (e: any) {
      logger.warn('[BulkAd OAuth] Invalid signed state:', e)
      await writeAuditLog(req, {
        category: 'bulk_ad',
        action: 'bulk_ad.facebook_oauth_callback',
        status: 'failed',
        targetType: 'facebook_oauth',
        summary: 'Facebook 授权回调 state 无效',
        reason: 'Invalid OAuth state',
        metadata: {
          stateParseError: stateAudit.error || e.message || 'Invalid OAuth state',
        },
      })
      return res.redirect('/oauth/callback?oauth_error=Invalid OAuth state')
    }
    
    // 处理 OAuth 回调（传递 state 以解析使用的 App）
    const result = await oauthService.handleOAuthCallback(code, state)
    
    // 更新 Token 的 userId 和 organizationId（关联到 AutoArk 用户）
    if (autoarkUserId) {
      await FbToken.findByIdAndUpdate(result.tokenId, {
        userId: autoarkUserId,
        ...(organizationId && { organizationId }),
      })
      logger.info(`[BulkAd OAuth] Token ${result.tokenId} bound to user ${autoarkUserId}`)
    }

    await writeAuditLog(req, {
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'success',
      userId: autoarkUserId,
      organizationId,
      targetType: 'facebook_token',
      targetId: result.tokenId,
      summary: `Facebook 授权成功：${result.fbUserName || result.fbUserId}`,
      metadata: {
        tokenId: result.tokenId,
        fbUserId: result.fbUserId,
        fbUserName: result.fbUserName,
      },
    })
    
    // 异步同步 Facebook 用户资产
    facebookUserService.syncFacebookUserAssets(
      result.fbUserId, 
      result.accessToken,
      result.tokenId,
      organizationId,
      async (adAccounts) => {
        try {
          await facebookAccountsService.syncCachedAccountsForToken(
            {
              _id: result.tokenId,
              token: result.accessToken,
              organizationId,
            },
            adAccounts,
          )
          await FbToken.findByIdAndUpdate(result.tokenId, { lastAccountSyncedAt: new Date() })
        } catch (err: any) {
          logger.error('[BulkAd OAuth] Failed to import Facebook account catalog:', err)
          await writeBulkAdAudit(req, {
            action: 'bulk_ad.facebook_account_catalog_sync',
            status: 'failed',
            userId: autoarkUserId,
            organizationId,
            targetType: 'facebook_token',
            targetId: result.tokenId,
            summary: `Facebook 授权后账户目录导入失败：${result.fbUserName || result.fbUserId}`,
            reason: err.message,
            metadata: {
              tokenId: result.tokenId,
              fbUserId: result.fbUserId,
            },
          })
        }
      },
      { force: true },
    ).catch(async (err: any) => {
      logger.error('[BulkAd OAuth] Failed to sync Facebook user assets:', err)
      await writeBulkAdAudit(req, {
        action: 'bulk_ad.facebook_asset_sync',
        status: 'failed',
        userId: autoarkUserId,
        organizationId,
        targetType: 'facebook_token',
        targetId: result.tokenId,
        summary: `Facebook 授权后资产同步失败：${result.fbUserName || result.fbUserId}`,
        reason: err.message,
        metadata: {
          tokenId: result.tokenId,
          fbUserId: result.fbUserId,
        },
      })
    }).catch(async (err: any) => {
      logger.error('[BulkAd OAuth] Failed to write Facebook asset sync audit:', err)
    })
    
    // 重定向到专门的 OAuth 回调页面
    const params = new URLSearchParams({
      oauth_success: 'true',
      token_id: result.tokenId,
      fb_user_id: result.fbUserId,
      fb_user_name: encodeURIComponent(result.fbUserName || ''),
    })
    
    res.redirect(`/oauth/callback?${params.toString()}`)
  } catch (error: any) {
    logger.error('[BulkAd OAuth] Callback handler failed:', error)
    await writeAuditLog(req, {
      category: 'bulk_ad',
      action: 'bulk_ad.facebook_oauth_callback',
      status: 'failed',
      userId: stateAudit.autoarkUserId,
      organizationId: stateAudit.organizationId,
      targetType: 'facebook_oauth',
      summary: 'Facebook 授权回调处理失败',
      reason: error.message || 'OAuth callback failed',
      metadata: {
        stateParseError: stateAudit.error,
      },
    })
    res.redirect(`/oauth/callback?oauth_error=${encodeURIComponent(error.message || 'OAuth callback failed')}`)
  }
}

/**
 * 检查授权状态（用户隔离）
 * GET /api/bulk-ad/auth/status
 * 
 * 每个 AutoArk 用户看到自己绑定的 Facebook 账号
 * 超级管理员可以看到所有 token
 */
export const getAuthStatus = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }
    
    const orgObjectId =
      req.user.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined
    
    // 构建查询条件
    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }
    
    // 超级管理员看到所有，普通用户只看到自己绑定的或本组织的
    if (req.user.role === UserRole.SUPER_ADMIN) {
      // 超级管理员：获取所有活跃 token，优先显示自己绑定的
      const userToken = await FbToken.findOne({ 
        status: 'active', 
        userId: req.user.userId 
      }).sort({ updatedAt: -1 })
      
      if (userToken) {
        return res.json({
          success: true,
          data: {
            authorized: true,
            tokenId: userToken._id,
            fbUserId: userToken.fbUserId,
            fbUserName: userToken.fbUserName,
            expiresAt: userToken.expiresAt,
            isOwnToken: true,
          },
        })
      }
      
      // 如果超级管理员没有绑定自己的 token，显示第一个可用的
      const anyToken: any = await FbToken.findOne({ status: 'active' }).sort({ updatedAt: -1 })
      if (anyToken) {
        return res.json({
          success: true,
          data: {
            authorized: true,
            tokenId: anyToken._id,
            fbUserId: anyToken.fbUserId,
            fbUserName: anyToken.fbUserName,
            expiresAt: anyToken.expiresAt,
            isOwnToken: false,
            message: '当前使用的是其他用户的授权，建议绑定自己的 Facebook 账号',
          },
        })
      }
    } else {
      Object.assign(tokenQuery, scopedTokenFilter(req))
    }
    
    const fbToken: any = await FbToken.findOne(tokenQuery).sort({ updatedAt: -1 })
    
    if (!fbToken) {
      return res.json({
        success: true,
        data: {
          authorized: false,
          message: '请先绑定您的 Facebook 账号',
        },
      })
    }
    
    res.json({
      success: true,
      data: {
        authorized: true,
        tokenId: fbToken._id,
        fbUserId: fbToken.fbUserId,
        fbUserName: fbToken.fbUserName,
        expiresAt: fbToken.expiresAt,
        isOwnToken: fbToken.userId === req.user.userId,
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get auth status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取当前授权资产诊断
 * GET /api/bulk-ad/auth/diagnostics
 */
export const getAuthDiagnostics = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }

    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }
    const tokens: any[] = await FbToken.find(tokenQuery)
      .select('_id fbUserId fbUserName expiresAt lastCheckedAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean()

    let users: any[] = []
    if (tokens.length > 0) {
      const tokenIds = tokens.map(token => token._id).filter(Boolean)
      const fbUserIds = tokens.map(token => token.fbUserId).filter(Boolean)
      const userFilters: any[] = tokenIds.length > 0 ? [{ tokenId: { $in: tokenIds } }] : []
      if (fbUserIds.length > 0) {
        userFilters.push({
          fbUserId: { $in: fbUserIds },
          ...(req.user.organizationId && { organizationId: req.user.organizationId }),
        })
      }
      users = await FacebookUser.find({ $or: userFilters }).lean()
    }

    const accountLimit = parseLimitedNumber(req.query.accountLimit, 100, 500)

    res.json({
      success: true,
      data: buildFacebookAssetDiagnostics({ tokens, users, accountLimit }),
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get auth diagnostics failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取当前授权用户的广告账户列表
 * GET /api/bulk-ad/auth/ad-accounts
 * 需要认证，并根据用户组织进行权限过滤
 * 
 * 超级管理员：获取所有 token 下的所有账户
 * 普通用户：只获取本组织 token 下的账户
 */
export const getAuthAdAccounts = async (req: Request, res: Response) => {
  try {
    // 检查用户认证
    if (!req.user) {
      return res.status(401).json({ success: false, error: '未认证' })
    }

    // 构建 token 查询条件（根据组织隔离）
    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }

    // 查找所有符合条件的 token（超级管理员看到所有，普通用户只看到本组织）
    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未找到可用的 Facebook 授权账号' })
    }
    
    // 合并所有 token 下的广告账户
    const allAccounts: any[] = []
    const seenAccountIds = new Set<string>()
    let fetchedPageCount = 0
    let failedTokenCount = 0
    let cacheTokenCount = 0
    let liveTokenCount = 0
    let paginationTruncated = false

    const addAccount = (account: any, tokenOwner: string, cached = false) => {
      const accountId = String(cached ? account.accountId : account.account_id)
      if (!accountId || accountId === 'undefined' || seenAccountIds.has(accountId)) {
        return
      }

      seenAccountIds.add(accountId)
      allAccounts.push({
        id: cached ? `act_${accountId}` : account.id,
        account_id: accountId,
        name: account.name,
        account_status: cached ? account.status : account.account_status,
        currency: account.currency,
        timezone_name: cached ? account.timezone : account.timezone_name,
        amount_spent: cached ? undefined : account.amount_spent,
        balance: cached ? undefined : account.balance,
        _tokenOwner: tokenOwner,
      })
    }
    
    for (const fbToken of fbTokens) {
      const tokenOwner = fbToken.fbUserName || fbToken.optimizer || 'unknown'
      try {
        if (fbToken.fbUserId) {
          try {
            const cachedSnapshot = await facebookUserService.getCachedAccountsWithMeta(
              fbToken.fbUserId,
              {
                tokenId: String(fbToken._id),
                organizationId: fbToken.organizationId
                  ? String(fbToken.organizationId)
                  : undefined,
              },
            )
            const cachedAccounts = cachedSnapshot.accounts

            if (cachedAccounts.length > 0) {
              cacheTokenCount += 1
              fetchedPageCount += cachedSnapshot.fetchedPageCount
              paginationTruncated = paginationTruncated || cachedSnapshot.paginationTruncated
              cachedAccounts.forEach((account: any) => addAccount(account, tokenOwner, true))
              continue
            }
          } catch (cacheError: any) {
            logger.warn(
              `[BulkAd] Failed to read cached accounts for ${tokenOwner}; falling back to Meta: ${cacheError.message}`,
            )
          }
        }

        liveTokenCount += 1
        const result = await fetchAuthAdAccountsPages(fbToken.token)
        fetchedPageCount += result.pageCount
        paginationTruncated = paginationTruncated || result.truncated
        
        for (const acc of result.accounts) {
          addAccount(acc, tokenOwner)
        }
      } catch (tokenError: any) {
        failedTokenCount += 1
        logger.warn(`[BulkAd] Failed to get accounts for ${tokenOwner}: ${tokenError.message}`)
        // 继续处理其他 token
      }
    }
    
    // 根据 Account 模型中的 organizationId 进行过滤（仅非超级管理员）
    let filteredAccounts = allAccounts
    if (req.user.role !== UserRole.SUPER_ADMIN && req.user.organizationId) {
      const allowedAccounts = await Account.find({
        accountId: { $in: Array.from(seenAccountIds) },
        organizationId: req.user.organizationId,
      }).select('accountId').lean()
      const allowedAccountIds = new Set(allowedAccounts.map((acc: any) => acc.accountId))
      filteredAccounts = allAccounts.filter((acc: any) => allowedAccountIds.has(acc.account_id))
    }
    
    res.json({
      success: true,
      data: filteredAccounts,
      meta: {
        tokenCount: fbTokens.length,
        failedTokenCount,
        accountCount: filteredAccounts.length,
        sourceAccountCount: allAccounts.length,
        fetchedPageCount,
        cacheTokenCount,
        liveTokenCount,
        pageSize: AUTH_FACEBOOK_ASSET_PAGE_SIZE,
        pageLimitPerToken: AUTH_FACEBOOK_ASSET_PAGE_LIMIT,
        paginationTruncated,
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get ad accounts failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pages
 * GET /api/bulk-ad/auth/pages
 * 
 * 策略：
 * 1. 先尝试从广告账户获取 promote_pages（BM 分配的主页）
 * 2. 如果没有结果，回退获取用户有广告权限的所有主页
 */
export const getAuthPages = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const {
      accountId: scopedAccountId,
      fbToken,
      facebookUserScope,
      cachedAccount,
    } = await getScopedTokenForAccount(req, accountId)

    if (cachedAccount && fbToken.fbUserId && facebookUserScope) {
      try {
        const cachedPages = await facebookUserService.getCachedPages(
          fbToken.fbUserId,
          scopedAccountId,
          facebookUserScope,
        )
        const sanitizedCachedPages = sanitizeFacebookPages(cachedPages).map((page: any) => ({
          ...page,
          id: page.id || page.pageId,
        }))

        return res.json({
          success: true,
          data: sanitizedCachedPages,
          ...(sanitizedCachedPages.length === 0
            ? { warning: '此账户没有可用的 Facebook 主页。请重新同步资产或检查主页分配。' }
            : {}),
          meta: {
            source: 'cache',
            pageCount: sanitizedCachedPages.length,
            fetchedPageCount: 0,
            paginationTruncated: false,
            promotePagesFailed: false,
          },
        })
      } catch (error: any) {
        logger.warn(
          `[BulkAd] Failed to read cached pages for ${scopedAccountId}; falling back to Meta: ${error.message}`,
        )
      }
    }
    
    // 1. 从广告账户获取 promote_pages（BM 分配的主页）
    let pages: any[] = []
    let source: 'promote_pages' | 'user_pages' | 'none' | 'cache' = 'none'
    let fetchedPageCount = 0
    let paginationTruncated = false
    let promotePagesFailed = false
    try {
      const promoteResult = await fetchFacebookAssetPages(
        `/act_${scopedAccountId}/promote_pages`,
        fbToken.token,
        'id,name,picture',
      )
      pages = promoteResult.items.filter((p: any) => p.id && p.name)
      fetchedPageCount += promoteResult.pageCount
      paginationTruncated = paginationTruncated || promoteResult.truncated
      if (pages.length > 0) source = 'promote_pages'
      logger.info(`[BulkAd] Found ${pages.length} promote_pages for account ${scopedAccountId}`)
    } catch (e: any) {
      promotePagesFailed = true
      logger.warn(`[BulkAd] Failed to get promote_pages for ${scopedAccountId}: ${e.message}`)
    }
    
    // 2. 如果没有 promote_pages，回退获取用户管理的主页
    if (pages.length === 0) {
      logger.info(`[BulkAd] No promote_pages for ${scopedAccountId}, falling back to user pages`)
      try {
        // 使用找到的 token 获取该用户管理的所有主页
        const userPagesResult = await fetchFacebookAssetPages(
          `/${fbToken.fbUserId}/accounts`,
          fbToken.token,
          'id,name,picture',
        )
        pages = userPagesResult.items.filter((p: any) => p.id && p.name)
        fetchedPageCount += userPagesResult.pageCount
        paginationTruncated = paginationTruncated || userPagesResult.truncated
        if (pages.length > 0) source = 'user_pages'
        logger.info(`[BulkAd] Found ${pages.length} user pages for account ${accountId}`)
      } catch (e: any) {
        logger.warn(`[BulkAd] Failed to get user pages: ${e.message}`)
      }
    }

    const pageMap = new Map<string, any>()
    for (const page of pages) {
      if (page?.id && !pageMap.has(page.id)) pageMap.set(page.id, page)
    }
    const sanitizedPages = sanitizeFacebookPages(Array.from(pageMap.values()))
    
    // 如果还是没有主页，返回警告
    if (sanitizedPages.length === 0) {
      return res.json({ 
        success: true, 
        data: [],
        warning: '此账户没有可用的 Facebook 主页。请确保您有主页管理权限。',
        meta: {
          source,
          fetchedPageCount,
          pageSize: AUTH_FACEBOOK_ASSET_PAGE_SIZE,
          pageLimit: AUTH_FACEBOOK_ASSET_PAGE_LIMIT,
          paginationTruncated,
          promotePagesFailed,
        },
      })
    }
    
    res.json({
      success: true,
      data: sanitizedPages,
      meta: {
        source,
        pageCount: sanitizedPages.length,
        fetchedPageCount,
        pageSize: AUTH_FACEBOOK_ASSET_PAGE_SIZE,
        pageLimit: AUTH_FACEBOOK_ASSET_PAGE_LIMIT,
        paginationTruncated,
        promotePagesFailed,
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get pages failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取账户的 Pixels
 * GET /api/bulk-ad/auth/pixels
 */
export const getAuthPixels = async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query
    const { accountId: scopedAccountId, fbToken } = await getScopedTokenForAccount(req, accountId)
    
    const result = await fetchFacebookAssetPages(
      `/act_${scopedAccountId}/adspixels`,
      fbToken.token,
      'id,name,code,last_fired_time',
    )
    
    res.json({
      success: true,
      data: result.items,
      meta: {
        pixelCount: result.items.length,
        fetchedPageCount: result.pageCount,
        pageSize: AUTH_FACEBOOK_ASSET_PAGE_SIZE,
        pageLimit: AUTH_FACEBOOK_ASSET_PAGE_LIMIT,
        paginationTruncated: result.truncated,
      },
    })
  } catch (error: any) {
    logger.error('[BulkAd] Get pixels failed:', error)
    res.status(error.statusCode || 500).json({ success: false, error: error.message })
  }
}

/**
 * 获取缓存的所有 Pixels（预加载，速度快）
 * GET /api/bulk-ad/auth/cached-pixels
 * 
 * 超级管理员：合并所有 token 的 Pixels
 * 普通用户：只获取本组织 token 的 Pixels
 */
export const getCachedPixels = async (req: Request, res: Response) => {
  try {
    const orgObjectId =
      req.user?.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined
    
    // 构建 token 查询条件（根据组织隔离）
    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }
    
    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    // 合并所有 token 的 Pixels
    const pixelMap = new Map<string, any>()
    
    for (const fbToken of fbTokens) {
      try {
        const pixels = await facebookUserService.getCachedPixels(fbToken.fbUserId, {
          tokenId: fbToken._id?.toString(),
          organizationId: fbToken.organizationId,
        })
        
        for (const p of pixels) {
          const existing = pixelMap.get(p.pixelId)
          if (existing) {
            // 合并账户列表（去重）
            const existingAccountIds = new Set(existing.accounts.map((a: any) => a.accountId))
            for (const acc of (p.accounts || [])) {
              if (!existingAccountIds.has(acc.accountId)) {
                existing.accounts.push(acc)
              }
            }
          } else {
            pixelMap.set(p.pixelId, {
              pixelId: p.pixelId,
              name: p.name,
              accounts: [...(p.accounts || [])],
            })
          }
        }
      } catch (tokenError: any) {
        logger.warn(`[BulkAd] Failed to get pixels for token ${fbToken.fbUserName}:`, tokenError.message)
      }
    }
    
    // 转换格式以兼容前端
    const formattedPixels = Array.from(pixelMap.values()).map((p: any) => ({
      id: p.pixelId,
      name: p.name,
      accounts: p.accounts || [],
    }))
    
    logger.info(`[BulkAd] Merged ${formattedPixels.length} pixels from ${fbTokens.length} tokens`)
    
    res.json({ success: true, data: formattedPixels })
  } catch (error: any) {
    logger.error('[BulkAd] Get cached pixels failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取缓存的 Catalogs（预加载，速度快）
 * GET /api/bulk-ad/auth/cached-catalogs
 */
export const getCachedCatalogs = async (req: Request, res: Response) => {
  try {
    const orgObjectId =
      req.user?.organizationId && mongoose.Types.ObjectId.isValid(req.user.organizationId)
        ? new mongoose.Types.ObjectId(req.user.organizationId)
        : undefined

    const tokenQuery: any = { status: 'active', ...scopedTokenFilter(req) }

    const fbTokens: any[] = await FbToken.find(tokenQuery).sort({ updatedAt: -1 })
    if (!fbTokens || fbTokens.length === 0) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }

    const catalogMap = new Map<string, any>()

    for (const fbToken of fbTokens) {
      try {
        const catalogs = await facebookUserService.getCachedCatalogs(fbToken.fbUserId, {
          tokenId: fbToken._id?.toString(),
          organizationId: fbToken.organizationId,
        })
        for (const c of catalogs) {
          if (!catalogMap.has(c.catalogId)) {
            catalogMap.set(c.catalogId, {
              id: c.catalogId,
              name: c.name,
              business: c.business,
            })
          }
        }
      } catch (e: any) {
        logger.warn(`[BulkAd] Failed to get catalogs for token ${fbToken.fbUserName}:`, e?.message || e)
      }
    }

    res.json({ success: true, data: Array.from(catalogMap.values()) })
  } catch (error: any) {
    logger.error('[BulkAd] Get cached catalogs failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取 Pixel 同步状态
 * GET /api/bulk-ad/auth/sync-status
 */
export const getPixelSyncStatus = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    const status = await facebookUserService.getSyncStatus(fbToken.fbUserId, {
      tokenId: fbToken._id?.toString(),
      organizationId: fbToken.organizationId,
    })
    
    res.json({ success: true, data: status })
  } catch (error: any) {
    logger.error('[BulkAd] Get sync status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 手动触发重新同步
 * POST /api/bulk-ad/auth/resync
 */
export const resyncFacebookAssets = async (req: Request, res: Response) => {
  try {
    const fbToken: any = await getScopedActiveToken(req)
    if (!fbToken) {
      return res.status(401).json({ success: false, error: '未授权 Facebook 账号' })
    }
    
    // 异步执行同步
    facebookUserService.syncFacebookTokenAssets(
      fbToken,
      { force: true },
    ).catch(async (err: any) => {
      logger.error('[BulkAd] Resync failed:', err)
      await writeBulkAdAudit(req, {
        action: 'bulk_ad.facebook_resync',
        status: 'failed',
        targetType: 'facebook_user',
        targetId: fbToken.fbUserId,
        summary: `Facebook 资产重同步后台失败：${fbToken.fbUserName || fbToken.fbUserId}`,
        reason: err.message,
        metadata: {
          tokenId: String(fbToken._id),
          fbUserId: fbToken.fbUserId,
        },
      })
    })

    await writeBulkAdAudit(req, {
      action: 'bulk_ad.facebook_resync',
      targetType: 'facebook_user',
      targetId: fbToken.fbUserId,
      summary: `手动触发 Facebook 资产重同步：${fbToken.fbUserName || fbToken.fbUserId}`,
      metadata: {
        tokenId: String(fbToken._id),
      },
    })
    
    res.json({ success: true, message: '同步已开始，请稍后刷新' })
  } catch (error: any) {
    logger.error('[BulkAd] Resync trigger failed:', error)
    await writeBulkAdAudit(req, {
      action: 'bulk_ad.facebook_resync',
      status: 'failed',
      summary: '手动触发 Facebook 资产重同步失败',
      reason: error.message,
    })
    res.status(500).json({ success: false, error: error.message })
  }
}

// ==================== 广告审核状态 ====================

/**
 * 获取任务的广告审核状态
 * GET /api/bulk-ad/tasks/:id/review-status
 */
export const getTaskReviewStatus = async (req: Request, res: Response) => {
  try {
    await bulkAdService.getTask(req.params.id, getAssetFilter(req))
    const { getTaskReviewDetails } = await import('../services/adReview.service')
    const result = await getTaskReviewDetails(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get task review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 检查/刷新任务的广告审核状态
 * POST /api/bulk-ad/tasks/:id/check-review
 */
export const checkTaskReviewStatus = async (req: Request, res: Response) => {
  try {
    await bulkAdService.getTask(req.params.id, getAssetFilter(req))
    const { updateTaskAdsReviewStatus } = await import('../services/adReview.service')
    const result = await updateTaskAdsReviewStatus(req.params.id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Check task review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 获取所有 AutoArk 广告审核概览
 * GET /api/bulk-ad/ads/review-overview
 */
export const getAdsReviewOverview = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const { getReviewOverview } = await import('../services/adReview.service')
    const result = await getReviewOverview()
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Get ads review overview failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

/**
 * 刷新所有 AutoArk 广告的审核状态
 * POST /api/bulk-ad/ads/refresh-review
 */
export const refreshAdsReviewStatus = async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== UserRole.SUPER_ADMIN) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const { refreshAllReviewStatus } = await import('../services/adReview.service')
    const result = await refreshAllReviewStatus()
    res.json({ success: true, data: result })
  } catch (error: any) {
    logger.error('[BulkAd] Refresh ads review status failed:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}
