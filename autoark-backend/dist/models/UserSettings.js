"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const userSettingsSchema = new mongoose_1.default.Schema({
    userId: { type: String, required: true, unique: true },
    campaignColumns: {
        type: [String],
        default: [
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
        ],
    },
});
exports.default = mongoose_1.default.model('UserSettings', userSettingsSchema);
