import * as fbApi from './facebook.api'
import { Campaign, AdSet, Ad, MetricsDaily, SyncLog, Creative } from '../models'
import logger from '../utils/logger'

// 1. Get Effective Accounts
export const getEffectiveAdAccounts = async (): Promise<string[]> => {
  // Priority: Env Array > Env Single > Auto-discover
  if (process.env.FB_ACCOUNT_IDS) {
    try {
      const ids = JSON.parse(process.env.FB_ACCOUNT_IDS)
      if (Array.isArray(ids) && ids.length > 0) return ids
    } catch (e) {
      logger.warn('Failed to parse FB_ACCOUNT_IDS')
    }
  }

  if (process.env.FB_AD_ACCOUNT_ID) {
    return [process.env.FB_AD_ACCOUNT_ID]
  }

  // Auto-discover
  const accounts = await fbApi.fetchUserAdAccounts()
  return accounts.map((a: any) => a.id)
}

// 6. Generic Mongo Writer
const writeToMongo = async (model: any, filter: any, data: any) => {
  try {
    await model.findOneAndUpdate(filter, data, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    })
  } catch (error) {
    logger.error(`Mongo Write Error: ${(error as Error).message}`)
  }
}

// 7. Sync Single Account
export const syncAccount = async (accountId: string) => {
  logger.info(`Syncing Account: ${accountId}`)

  // 1. Campaigns
  try {
    const campaigns = await fbApi.fetchCampaigns(accountId)
    logger.info(`Syncing ${campaigns.length} campaigns for ${accountId}`)
    for (const c of campaigns) {
      await writeToMongo(
        Campaign,
        { campaignId: c.id },
        {
          campaignId: c.id,
          accountId,
          name: c.name,
          status: c.status,
          objective: c.objective,
          created_time: c.created_time,
          updated_time: c.updated_time,
          raw: c,
        },
      )
    }
  } catch (err) {
    logger.error(`Failed to sync campaigns for ${accountId}`, err)
  }

  // 2. AdSets
  try {
    const adsets = await fbApi.fetchAdSets(accountId)
    logger.info(`Syncing ${adsets.length} adsets for ${accountId}`)
    for (const a of adsets) {
      await writeToMongo(
        AdSet,
        { adsetId: a.id },
        {
          adsetId: a.id,
          accountId,
          campaignId: a.campaign_id,
          name: a.name,
          status: a.status,
          optimizationGoal: a.optimization_goal,
          budget: a.daily_budget ? parseInt(a.daily_budget) : 0,
          created_time: a.created_time,
          updated_time: a.updated_time,
          raw: a,
        },
      )
    }
  } catch (err) {
    logger.error(`Failed to sync adsets for ${accountId}`, err)
  }

  // 3. Ads
  try {
    const ads = await fbApi.fetchAds(accountId)
    logger.info(`Syncing ${ads.length} ads for ${accountId}`)
    for (const a of ads) {
      await writeToMongo(
        Ad,
        { adId: a.id },
        {
          adId: a.id,
          accountId,
          adsetId: a.adset_id,
          campaignId: a.campaign_id,
          name: a.name,
          status: a.status,
          creativeId: a.creative?.id,
          created_time: a.created_time,
          updated_time: a.updated_time,
          raw: a,
        },
      )
    }
  } catch (err) {
    logger.error(`Failed to sync ads for ${accountId}`, err)
  }

  // 4. Creatives (Optional but good to have)
  try {
    const creatives = await fbApi.fetchCreatives(accountId)
    logger.info(`Syncing ${creatives.length} creatives for ${accountId}`)
    for (const c of creatives) {
      await writeToMongo(
        Creative,
        { creativeId: c.id },
        {
          creativeId: c.id,
          channel: 'facebook',
          name: c.name,
          storageUrl: c.image_url || c.thumbnail_url, // Simplification
          // type, hash etc can be extracted if needed
        },
      )
    }
  } catch (err) {
    logger.error(`Failed to sync creatives for ${accountId}`, err)
  }

  // 5. Insights (Daily)
  try {
    const insights = await fbApi.fetchInsights(accountId, 'today') // or 'yesterday'
    logger.info(`Syncing ${insights.length} insight records for ${accountId}`)

    for (const i of insights) {
      const spendUsd = parseFloat(i.spend || '0')
      const impressions = parseInt(i.impressions || '0')
      const clicks = parseInt(i.clicks || '0')

      // Extract installs
      const actions = i.actions || []
      const installAction = actions.find(
        (a: any) => a.action_type === 'mobile_app_install',
      )
      const installs = installAction ? parseFloat(installAction.value) : 0

      await writeToMongo(
        MetricsDaily,
        { adId: i.ad_id, date: i.date_start },
        {
          date: i.date_start,
          channel: 'facebook',
          accountId,
          campaignId: i.campaign_id,
          adsetId: i.adset_id,
          adId: i.ad_id,
          impressions,
          clicks,
          spendUsd,
          cpc: i.cpc ? parseFloat(i.cpc) : 0,
          ctr: i.ctr ? parseFloat(i.ctr) : 0,
          cpm: i.cpm ? parseFloat(i.cpm) : 0,
          installs,
          raw: i,
        },
      )
    }
  } catch (err) {
    logger.error(`Failed to sync insights for ${accountId}`, err)
  }
}

// 8. Full Sync Runner
export const runFullSync = async () => {
  const startTime = new Date()
  logger.info('Starting Full Facebook Sync...')

  let syncLog
  try {
    syncLog = await SyncLog.create({ startTime, status: 'RUNNING' })

    const accountIds = await getEffectiveAdAccounts()
    logger.info(
      `Syncing ${accountIds.length} accounts: ${accountIds.join(', ')}`,
    )

    for (const accountId of accountIds) {
      await syncAccount(accountId)
    }

    syncLog.endTime = new Date()
    syncLog.status = 'SUCCESS'
    syncLog.details = { accountsSynced: accountIds.length }
    await syncLog.save()
    logger.info('Full Facebook Sync Completed Successfully.')
  } catch (error) {
    const msg = (error as Error).message
    logger.error(`Full Facebook Sync Failed: ${msg}`)
    if (syncLog) {
      syncLog.endTime = new Date()
      syncLog.status = 'FAILED'
      syncLog.error = msg
      await syncLog.save()
    }
  }
}
