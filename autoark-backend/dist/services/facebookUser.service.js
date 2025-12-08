"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSyncStatus = exports.getCachedPages = exports.getCachedAccounts = exports.getCachedPixels = exports.syncFacebookUserAssets = void 0;
const FacebookUser_1 = __importDefault(require("../models/FacebookUser"));
const logger_1 = __importDefault(require("../utils/logger"));
const FB_API_VERSION = 'v21.0';
const FB_BASE_URL = `https://graph.facebook.com/${FB_API_VERSION}`;
/**
 * 同步 Facebook 用户的所有资产（Pixels、账户、粉丝页）
 */
const syncFacebookUserAssets = async (fbUserId, accessToken, tokenId) => {
    logger_1.default.info(`[FacebookUser] Starting sync for user ${fbUserId}`);
    try {
        // 更新同步状态
        await FacebookUser_1.default.findOneAndUpdate({ fbUserId }, {
            fbUserId,
            tokenId,
            syncStatus: 'syncing',
            $unset: { syncError: 1 }
        }, { upsert: true, new: true });
        // 1. 获取所有广告账户
        const accounts = await fetchAdAccounts(accessToken);
        logger_1.default.info(`[FacebookUser] Found ${accounts.length} ad accounts`);
        // 2. 获取所有 Pixels（汇总所有账户的）
        const pixelMap = new Map();
        for (const account of accounts) {
            const accountId = account.account_id || account.id?.replace('act_', '');
            try {
                const pixels = await fetchAccountPixels(accountId, accessToken);
                for (const pixel of pixels) {
                    if (!pixelMap.has(pixel.id)) {
                        pixelMap.set(pixel.id, {
                            pixelId: pixel.id,
                            name: pixel.name,
                            accounts: [{ accountId, accountName: account.name }],
                            lastSyncedAt: new Date(),
                        });
                    }
                    else {
                        const existing = pixelMap.get(pixel.id);
                        // 检查账户是否已存在
                        if (!existing.accounts.find((a) => a.accountId === accountId)) {
                            existing.accounts.push({ accountId, accountName: account.name });
                        }
                    }
                }
            }
            catch (err) {
                logger_1.default.warn(`[FacebookUser] Failed to fetch pixels for account ${accountId}:`, err);
            }
        }
        // 3. 获取所有粉丝页
        const pagesMap = new Map();
        for (const account of accounts) {
            const accountId = account.account_id || account.id?.replace('act_', '');
            try {
                const pages = await fetchAccountPages(accountId, accessToken);
                for (const page of pages) {
                    if (!pagesMap.has(page.id)) {
                        pagesMap.set(page.id, {
                            pageId: page.id,
                            name: page.name,
                            accessToken: page.access_token,
                            accounts: [{ accountId }],
                        });
                    }
                    else {
                        const existing = pagesMap.get(page.id);
                        if (!existing.accounts.find((a) => a.accountId === accountId)) {
                            existing.accounts.push({ accountId });
                        }
                    }
                }
            }
            catch (err) {
                logger_1.default.warn(`[FacebookUser] Failed to fetch pages for account ${accountId}:`, err);
            }
        }
        // 4. 保存到数据库
        const result = await FacebookUser_1.default.findOneAndUpdate({ fbUserId }, {
            fbUserId,
            tokenId,
            pixels: Array.from(pixelMap.values()),
            adAccounts: accounts.map(acc => ({
                accountId: acc.account_id || acc.id?.replace('act_', ''),
                name: acc.name,
                status: acc.account_status,
                currency: acc.currency,
                timezone: acc.timezone_name,
            })),
            pages: Array.from(pagesMap.values()),
            lastSyncedAt: new Date(),
            syncStatus: 'completed',
        }, { upsert: true, new: true });
        logger_1.default.info(`[FacebookUser] Sync completed for ${fbUserId}: ${pixelMap.size} pixels, ${accounts.length} accounts, ${pagesMap.size} pages`);
        return result;
    }
    catch (error) {
        logger_1.default.error(`[FacebookUser] Sync failed for ${fbUserId}:`, error);
        await FacebookUser_1.default.findOneAndUpdate({ fbUserId }, {
            syncStatus: 'failed',
            syncError: error.message,
        });
        throw error;
    }
};
exports.syncFacebookUserAssets = syncFacebookUserAssets;
/**
 * 获取缓存的 Pixels
 */
const getCachedPixels = async (fbUserId) => {
    const user = await FacebookUser_1.default.findOne({ fbUserId });
    return user?.pixels || [];
};
exports.getCachedPixels = getCachedPixels;
/**
 * 获取缓存的账户
 */
const getCachedAccounts = async (fbUserId) => {
    const user = await FacebookUser_1.default.findOne({ fbUserId });
    return user?.adAccounts || [];
};
exports.getCachedAccounts = getCachedAccounts;
/**
 * 获取缓存的粉丝页
 */
const getCachedPages = async (fbUserId, accountId) => {
    const user = await FacebookUser_1.default.findOne({ fbUserId });
    if (!user?.pages)
        return [];
    if (accountId) {
        // 筛选该账户可用的粉丝页
        return user.pages.filter((p) => p.accounts?.some((a) => a.accountId === accountId));
    }
    return user.pages;
};
exports.getCachedPages = getCachedPages;
/**
 * 获取同步状态
 */
const getSyncStatus = async (fbUserId) => {
    const user = await FacebookUser_1.default.findOne({ fbUserId });
    return {
        status: user?.syncStatus || 'pending',
        lastSyncedAt: user?.lastSyncedAt,
        error: user?.syncError,
        pixelCount: user?.pixels?.length || 0,
        accountCount: user?.adAccounts?.length || 0,
        pageCount: user?.pages?.length || 0,
    };
};
exports.getSyncStatus = getSyncStatus;
// ============ Helper Functions ============
async function fetchAdAccounts(accessToken) {
    const url = `${FB_BASE_URL}/me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name&limit=100&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.message);
    }
    return data.data || [];
}
async function fetchAccountPixels(accountId, accessToken) {
    const url = `${FB_BASE_URL}/act_${accountId}/adspixels?fields=id,name&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.message);
    }
    return data.data || [];
}
async function fetchAccountPages(accountId, accessToken) {
    const url = `${FB_BASE_URL}/act_${accountId}/promote_pages?fields=id,name,access_token&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.message);
    }
    return data.data || [];
}
exports.default = {
    syncFacebookUserAssets: exports.syncFacebookUserAssets,
    getCachedPixels: exports.getCachedPixels,
    getCachedAccounts: exports.getCachedAccounts,
    getCachedPages: exports.getCachedPages,
    getSyncStatus: exports.getSyncStatus,
};
