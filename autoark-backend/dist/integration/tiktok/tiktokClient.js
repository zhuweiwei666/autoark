"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tiktokClient = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../../utils/logger"));
const TIKTOK_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';
exports.tiktokClient = {
    async get(path, params = {}, accessToken) {
        try {
            const response = await axios_1.default.get(`${TIKTOK_BASE_URL}${path}`, {
                params,
                headers: accessToken ? { 'Access-Token': accessToken } : {},
            });
            if (response.data.code !== 0) {
                throw new Error(`TikTok API Error: ${response.data.message} (code: ${response.data.code})`);
            }
            return response.data.data;
        }
        catch (error) {
            logger_1.default.error(`[TikTokClient] GET ${path} failed:`, error.response?.data || error.message);
            throw error;
        }
    },
    async post(path, data = {}, accessToken) {
        try {
            const response = await axios_1.default.post(`${TIKTOK_BASE_URL}${path}`, data, {
                headers: accessToken ? { 'Access-Token': accessToken } : {},
            });
            if (response.data.code !== 0) {
                throw new Error(`TikTok API Error: ${response.data.message} (code: ${response.data.code})`);
            }
            return response.data.data;
        }
        catch (error) {
            logger_1.default.error(`[TikTokClient] POST ${path} failed:`, error.response?.data || error.message);
            throw error;
        }
    }
};
