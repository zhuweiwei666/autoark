"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveCampaignColumnSettings = exports.getCampaignColumnSettings = void 0;
const UserSettings_1 = __importDefault(require("../models/UserSettings"));
const logger_1 = __importDefault(require("../utils/logger"));
const getCampaignColumnSettings = async (userId) => {
    try {
        const settings = await UserSettings_1.default.findOne({ userId });
        if (settings && settings.campaignColumns) {
            return settings.campaignColumns;
        }
        // 返回默认列
        return [
            'name',
            'accountId',
            'spend',
            'cpm',
            'ctr',
            'cpc',
            'cpi',
            'purchase_value',
            'roas',
            'event_conversions',
        ];
    }
    catch (error) {
        logger_1.default.error(`Failed to get campaign column settings for user ${userId}: ${error.message}`);
        throw error;
    }
};
exports.getCampaignColumnSettings = getCampaignColumnSettings;
const saveCampaignColumnSettings = async (userId, columns) => {
    try {
        const settings = await UserSettings_1.default.findOneAndUpdate({ userId }, { campaignColumns: columns }, { upsert: true, new: true });
        return settings.campaignColumns || [];
    }
    catch (error) {
        logger_1.default.error(`Failed to save campaign column settings for user ${userId}: ${error.message}`);
        throw error;
    }
};
exports.saveCampaignColumnSettings = saveCampaignColumnSettings;
