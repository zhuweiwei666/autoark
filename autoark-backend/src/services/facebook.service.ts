import axios from 'axios';
import dotenv from 'dotenv';
import { MetricsDaily } from '../models'; // Unified export
import logger from '../utils/logger';

dotenv.config();

const FB_API_VERSION = 'v18.0';
const FB_BASE_URL = 'https://graph.facebook.com';

const getAccessToken = () => {
  const token = process.env.FB_ACCESS_TOKEN;
  if (!token) {
    throw new Error('FB_ACCESS_TOKEN is not defined in environment variables');
  }
  return token;
};

// Generic error handler helper
const handleApiError = (context: string, error: any) => {
  const errMsg = error.response?.data?.error?.message || error.message;
  logger.error(`Facebook API Error [${context}]: ${errMsg}`, error.response?.data);
  throw new Error(`Facebook API [${context}] failed: ${errMsg}`);
};

export const getAccountInfo = async (accountId: string) => {
  try {
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}`;
    const res = await axios.get(url, {
      params: {
        access_token: getAccessToken(),
        fields: 'id,name,currency,timezone_name'
      }
    });
    return res.data;
  } catch (error) {
    handleApiError('getAccountInfo', error);
  }
};

export const getCampaigns = async (accountId: string) => {
  try {
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/campaigns`;
    const res = await axios.get(url, {
       params: {
         access_token: getAccessToken(),
         fields: 'id,name,objective,status,start_time,stop_time',
         limit: 1000 // Handle pagination in real prod
       }
    });
    return res.data; // Usually { data: [...] }
  } catch (error) {
    handleApiError('getCampaigns', error);
  }
};

export const getAdSets = async (accountId: string) => {
  try {
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/adsets`;
    const res = await axios.get(url, {
       params: {
         access_token: getAccessToken(),
         fields: 'id,name,optimization_goal,billing_event,bid_amount,daily_budget,campaign_id,status,targeting',
         limit: 1000
       }
    });
    return res.data;
  } catch (error) {
    handleApiError('getAdSets', error);
  }
};

export const getAds = async (accountId: string) => {
  try {
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/ads`;
    const res = await axios.get(url, {
       params: {
         access_token: getAccessToken(),
         fields: 'id,name,status,creative{id},adset_id,campaign_id',
         limit: 1000
       }
    });
    return res.data;
  } catch (error) {
    handleApiError('getAds', error);
  }
};

/**
 * Fetch daily insights and upsert into DB
 */
export const getInsightsDaily = async (accountId: string, dateRange?: { since: string; until: string }) => {
  try {
    const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/insights`;
    
    // Requested fields
    const fields = [
      'campaign_id',
      'adset_id',
      'ad_id',
      'impressions',
      'clicks',
      'spend',
      'actions',
      'action_values',
      'cpc',
      'cpm',
      'ctr',
      'cost_per_action_type',
      'purchase_roas',
      'date_start', // FB returns date_start/date_stop for the window
      'date_stop'
    ].join(',');

    const params: any = {
      access_token: getAccessToken(),
      level: 'ad',
      fields: fields,
      time_increment: 1, // Daily breakdown
      limit: 500
    };

    if (dateRange) {
      params.time_range = JSON.stringify(dateRange);
    } else {
      params.date_preset = 'yesterday';
    }

    const res = await axios.get(url, { params });
    const insights = res.data.data || [];

    logger.info(`Fetched ${insights.length} daily insight records for account ${accountId}`);

    const processedData = [];

    for (const item of insights) {
      // 1. Extract Installs (mobile_app_install)
      const actions = item.actions || [];
      const installAction = actions.find((a: any) => a.action_type === 'mobile_app_install');
      const installs = installAction ? parseFloat(installAction.value) : 0;

      // 2. Extract Revenue/ROAS
      // 'action_values' usually contains purchase value
      const actionValues = item.action_values || [];
      const purchaseValue = actionValues.find((a: any) => a.action_type === 'purchase' || a.action_type === 'mobile_app_purchase'); // Adjust based on specific event name
      const revenueD0 = purchaseValue ? parseFloat(purchaseValue.value) : 0;

      // purchase_roas is array of { action_type, value }
      const roasStats = item.purchase_roas || [];
      const totalRoas = roasStats.reduce((acc: number, cur: any) => acc + parseFloat(cur.value || '0'), 0);
      // Or if there's a specific 'purchase' action type for ROAS
      // For simplicity taking the aggregated value if single or just summing up

      const spendUsd = parseFloat(item.spend || '0');
      
      // 3. Calculate Derived Metrics
      const cpiUsd = installs > 0 ? spendUsd / installs : 0;
      
      // 4. Construct Internal Format
      const record = {
        date: item.date_start, // YYYY-MM-DD
        channel: 'facebook',
        accountId: accountId,
        campaignId: item.campaign_id,
        adsetId: item.adset_id,
        adId: item.ad_id,
        impressions: parseInt(item.impressions || '0', 10),
        clicks: parseInt(item.clicks || '0', 10),
        installs,
        spendUsd,
        revenueD0, // Assuming D0 for daily fetch
        cpiUsd,
        roiD0: totalRoas, // ROAS
        raw: item // Store raw FB response for debugging
      };

      // 5. Upsert into MongoDB
      await MetricsDaily.findOneAndUpdate(
        { 
          date: record.date, 
          adId: record.adId, 
          accountId: record.accountId 
        },
        record,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      processedData.push(record);
    }

    logger.info(`Successfully upserted ${processedData.length} records into MetricsDaily`);
    return processedData;

  } catch (error) {
    handleApiError('getInsightsDaily', error);
  }
};
