import { Account } from '../models'
import * as facebookService from '../services/facebook.service'
import logger from '../utils/logger'

const fetchFacebookDaily = async () => {
  logger.info('Starting scheduled Facebook daily insights fetch...')

  try {
    // 1. Get all active Facebook accounts
    const accounts = await Account.find({
      channel: 'facebook',
      status: 'active',
    })

    if (accounts.length === 0) {
      logger.info('No active Facebook accounts found to fetch.')
      return
    }

    logger.info(`Found ${accounts.length} active Facebook accounts.`)

    // 2. Fetch insights for each account
    for (const account of accounts) {
      try {
        logger.info(
          `Fetching insights for account: ${account.name} (${account.accountId})`,
        )
        // Fetches yesterday's data by default
        await facebookService.getInsightsDaily(account.accountId)
        logger.info(
          `Successfully fetched insights for account: ${account.accountId}`,
        )
      } catch (error) {
        logger.error(
          `Failed to fetch insights for account ${account.accountId}`,
          error,
        )
        // Continue to next account even if one fails
      }
    }

    logger.info('Scheduled Facebook daily insights fetch completed.')
  } catch (error) {
    logger.error('Critical error in fetchFacebookDaily cron job', error)
  }
}

export default fetchFacebookDaily
