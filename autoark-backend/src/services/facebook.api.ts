// Re-export from integration layer
import { facebookClient } from '../integration/facebook/facebookClient'
import { fetchUserAdAccounts } from '../integration/facebook/accounts.api'
import { fetchCampaigns } from '../integration/facebook/campaigns.api'
import { fetchAdSets, fetchAds, fetchCreatives } from '../integration/facebook/ads.api'
import { fetchInsights } from '../integration/facebook/insights.api'

// Keep the same exports as before for compatibility
export const fbClient = facebookClient
export {
  fetchUserAdAccounts,
  fetchCampaigns,
  fetchAdSets,
  fetchAds,
  fetchCreatives,
  fetchInsights
}
