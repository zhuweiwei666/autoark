"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("../models");
const facebookService = __importStar(require("../services/facebook.service"));
const logger_1 = __importDefault(require("../utils/logger"));
const fetchFacebookMetrics = async () => {
    logger_1.default.info('Starting scheduled Facebook daily insights fetch...');
    try {
        // 1. Get all active Facebook accounts
        const accounts = await models_1.Account.find({
            channel: 'facebook',
            status: 'active',
        });
        if (accounts.length === 0) {
            logger_1.default.info('No active Facebook accounts found to fetch.');
            return;
        }
        logger_1.default.info(`Found ${accounts.length} active Facebook accounts.`);
        // 2. Fetch insights for each account
        for (const account of accounts) {
            try {
                logger_1.default.info(`Fetching insights for account: ${account.name} (${account.accountId})`);
                // Fetches yesterday's data by default
                await facebookService.getInsightsDaily(account.accountId);
                logger_1.default.info(`Successfully fetched insights for account: ${account.accountId}`);
            }
            catch (error) {
                logger_1.default.error(`Failed to fetch insights for account ${account.accountId}`, error);
                // Continue to next account even if one fails
            }
        }
        logger_1.default.info('Scheduled Facebook daily insights fetch completed.');
    }
    catch (error) {
        logger_1.default.error('Critical error in fetchFacebookMetrics cron job', error);
    }
};
exports.default = fetchFacebookMetrics;
