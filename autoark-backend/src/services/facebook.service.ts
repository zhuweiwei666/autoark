import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const FB_API_VERSION = 'v18.0';
const FB_BASE_URL = 'https://graph.facebook.com';

const getAccessToken = () => process.env.FB_ACCESS_TOKEN;

export const getAccountInfo = async (accountId: string) => {
  // TODO: Implement full account info fetch
  const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}`;
  const res = await axios.get(url, {
    params: {
      access_token: getAccessToken(),
      fields: 'id,name,currency,timezone_name'
    }
  });
  return res.data;
};

export const getCampaigns = async (accountId: string) => {
  const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/campaigns`;
  const res = await axios.get(url, {
     params: {
       access_token: getAccessToken(),
       fields: 'id,name,objective,status'
     }
  });
  return res.data;
};

export const getAdSets = async (accountId: string) => {
  // TODO: Add more fields
  const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/adsets`;
  const res = await axios.get(url, {
     params: {
       access_token: getAccessToken(),
       fields: 'id,name,optimization_goal,billing_event,bid_amount,daily_budget,campaign_id,status'
     }
  });
  return res.data;
};

export const getAds = async (accountId: string) => {
  // TODO: Add more fields
  const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/ads`;
  const res = await axios.get(url, {
     params: {
       access_token: getAccessToken(),
       fields: 'id,name,status,creative{id},adset_id'
     }
  });
  return res.data;
};

export const getInsightsDaily = async (accountId: string) => {
  // TODO: Implement date range and granularity
  const url = `${FB_BASE_URL}/${FB_API_VERSION}/${accountId}/insights`;
  const res = await axios.get(url, {
     params: {
       access_token: getAccessToken(),
       level: 'ad',
       date_preset: 'yesterday',
       fields: 'campaign_id,adset_id,ad_id,impressions,clicks,spend,actions'
     }
  });
  return res.data;
};

