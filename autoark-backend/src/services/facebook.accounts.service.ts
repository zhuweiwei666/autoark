import axios from 'axios'
import logger from '../utils/logger'
import { getFacebookAccessToken } from '../utils/fbToken'

const FB_API_VERSION = 'v19.0'
const FB_BASE_URL = 'https://graph.facebook.com'

/**
 * Fetch all ad accounts associated with the current user token.
 * Automatically filters for active accounts (account_status = 1).
 * Returns an array of account IDs (e.g., ["act_123", "act_456"]).
 */
export async function fetchUserAdAccounts(): Promise<string[]> {
  const startTime = Date.now()
  logger.info('[Facebook API] fetchUserAdAccounts started')

  try {
    const token = await getFacebookAccessToken()
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/me/adaccounts`

    // account_status: 1 = Active, 2 = Disabled, 3 = Unsettled, 7 = Pending_risk_review, 8 = Pending_settlement, 9 = In_grace_period, 100 = Pending_closure, 101 = Closed, 201 = Any_active, 202 = Any_closed
    const response = await axios.get(url, {
      params: {
        access_token: token,
        fields: 'id,account_status,name',
        limit: 500,
      },
    })

    const accounts = response.data.data || []

    // Filter for active accounts (status 1)
    // Note: Adjust logic if you want to include other statuses like 'In grace period' etc.
    const activeAccounts = accounts
      .filter((acc: any) => acc.account_status === 1)
      .map((acc: any) => acc.id)

    logger.timerLog('[Facebook API] fetchUserAdAccounts', startTime)
    logger.info(
      `Found ${activeAccounts.length} active ad accounts out of ${accounts.length} total.`,
    )

    return activeAccounts
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.message
    logger.error(
      `[Facebook API] fetchUserAdAccounts failed: ${errMsg}`,
      error.response?.data,
    )
    throw new Error(`Failed to fetch user ad accounts: ${errMsg}`)
  }
}
