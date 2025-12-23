import cron from 'node-cron'
import logger from '../utils/logger'
import FbToken from '../models/FbToken'
import { syncFacebookUserAssets } from '../services/facebookUser.service'

/**
 * FacebookUser 资产同步（Pixels/Pages/Catalogs/AdAccounts）
 * - 用于让“资产选择”基本不依赖实时拉取，提升速度与稳定性
 * - 频率不宜过高，避免触发 Graph API 限流
 */
export const initFacebookUserAssetsCron = () => {
  // Every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      const tokens: any[] = await FbToken.find({ status: 'active' }).lean()
      if (!tokens.length) return

      logger.info(`[FacebookUserCron] Start syncing assets for ${tokens.length} tokens`)

      // 简单分批并行，避免一次性打爆 API
      const batchSize = 3
      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize)
        await Promise.all(
          batch.map(async (t) => {
            if (!t.fbUserId || !t.token) return
            try {
              await syncFacebookUserAssets(t.fbUserId, t.token, String(t._id))
            } catch (e: any) {
              logger.warn(`[FacebookUserCron] Sync failed for token ${t._id}: ${e?.message || e}`)
            }
          }),
        )
      }

      logger.info('[FacebookUserCron] Assets sync finished')
    } catch (e: any) {
      logger.error('[FacebookUserCron] Unhandled error:', e?.message || e)
    }
  })
}

