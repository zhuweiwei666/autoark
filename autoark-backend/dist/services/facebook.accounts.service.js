"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchUserAdAccounts = fetchUserAdAccounts;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../utils/logger"));
const fbToken_1 = require("../utils/fbToken");
const FB_API_VERSION = 'v19.0';
const FB_BASE_URL = 'https://graph.facebook.com';
/**
 * Fetch all ad accounts associated with the current user token.
 * Automatically filters for active accounts (account_status = 1).
 * Returns an array of account IDs (e.g., ["act_123", "act_456"]).
 */
async function fetchUserAdAccounts() {
    const startTime = Date.now();
    logger_1.default.info('[Facebook API] fetchUserAdAccounts started');
    try {
        const token = await (0, fbToken_1.getFacebookAccessToken)();
        const url = `${FB_BASE_URL}/${FB_API_VERSION}/me/adaccounts`;
        // account_status: 1 = Active, 2 = Disabled, 3 = Unsettled, 7 = Pending_risk_review, 8 = Pending_settlement, 9 = In_grace_period, 100 = Pending_closure, 101 = Closed, 201 = Any_active, 202 = Any_closed
        const response = await axios_1.default.get(url, {
            params: {
                access_token: token,
                fields: 'id,account_status,name',
                limit: 500,
            },
        });
        const accounts = response.data.data || [];
        // Filter for active accounts (status 1)
        // Note: Adjust logic if you want to include other statuses like 'In grace period' etc.
        const activeAccounts = accounts
            .filter((acc) => acc.account_status === 1)
            .map((acc) => acc.id);
        logger_1.default.timerLog('[Facebook API] fetchUserAdAccounts', startTime);
        logger_1.default.info(`Found ${activeAccounts.length} active ad accounts out of ${accounts.length} total.`);
        return activeAccounts;
    }
    catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        logger_1.default.error(`[Facebook API] fetchUserAdAccounts failed: ${errMsg}`, error.response?.data);
        throw new Error(`Failed to fetch user ad accounts: ${errMsg}`);
    }
}
