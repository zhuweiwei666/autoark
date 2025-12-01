# Facebook Data Synchronization

The system automatically synchronizes data from Facebook Ads Manager to the local MongoDB database.

## Sync Process

1.  **Auto-discovery**: Identifies all active ad accounts for the user.
2.  **Data Fetching**: Pulls Campaigns, AdSets, Ads, Creatives, and Daily Insights.
3.  **Storage**: Upserts data into MongoDB to keep it up-to-date.

## Frequency

- **Daily Insights**: Fetched every 10 minutes (configurable via `CRON_SYNC_INTERVAL`).
- **Metadata**: Synced alongside insights.

## Key Files

- `src/services/facebook.sync.service.ts`
- `src/services/facebook.api.ts`
- `src/cron/sync.cron.ts`

