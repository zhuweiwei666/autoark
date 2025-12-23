"use strict";
/**
 * 📊 预聚合数据表
 *
 * 设计原则：
 * 1. 每个前端表格对应一个后端预聚合表
 * 2. 最近 3 天：每次请求从 Facebook API 实时获取，并更新到数据库
 * 3. 超过 3 天：直接从数据库读取（历史快照，不再更新）
 * 4. AI 直接读取这些表
 *
 * 性能优化：
 * - 减少 Facebook API 调用（只请求最近 3 天）
 * - 历史数据直接读取，响应速度快
 * - 数据一致性：历史数据固定不变
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggOptimizer = exports.AggCampaign = exports.AggAccount = exports.AggCountry = exports.AggDaily = void 0;
exports.isRecentDate = isRecentDate;
// 判断日期是否在最近 3 天内
function isRecentDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 2; // 今天、昨天、前天
}
const mongoose_1 = __importStar(require("mongoose"));
const aggDailySchema = new mongoose_1.Schema({
    date: { type: String, required: true, unique: true, index: true },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpm: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpi: { type: Number, default: 0 },
    activeCampaigns: { type: Number, default: 0 },
    activeAccounts: { type: Number, default: 0 },
}, { timestamps: true });
exports.AggDaily = mongoose_1.default.model('AggDaily', aggDailySchema);
const aggCountrySchema = new mongoose_1.Schema({
    date: { type: String, required: true, index: true },
    country: { type: String, required: true, index: true },
    countryName: { type: String, default: '' },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    campaigns: { type: Number, default: 0 },
}, { timestamps: true });
aggCountrySchema.index({ date: 1, country: 1 }, { unique: true });
exports.AggCountry = mongoose_1.default.model('AggCountry', aggCountrySchema);
const aggAccountSchema = new mongoose_1.Schema({
    date: { type: String, required: true, index: true },
    accountId: { type: String, required: true, index: true },
    accountName: { type: String, default: '' },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    campaigns: { type: Number, default: 0 },
    status: { type: String, default: 'active' },
}, { timestamps: true });
aggAccountSchema.index({ date: 1, accountId: 1 }, { unique: true });
exports.AggAccount = mongoose_1.default.model('AggAccount', aggAccountSchema);
const aggCampaignSchema = new mongoose_1.Schema({
    date: { type: String, required: true, index: true },
    campaignId: { type: String, required: true, index: true },
    campaignName: { type: String, default: '' },
    accountId: { type: String, default: '' },
    accountName: { type: String, default: '' },
    optimizer: { type: String, default: '' },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    cpc: { type: Number, default: 0 },
    cpi: { type: Number, default: 0 },
    status: { type: String, default: 'ACTIVE' },
    objective: { type: String, default: '' },
}, { timestamps: true });
aggCampaignSchema.index({ date: 1, campaignId: 1 }, { unique: true });
aggCampaignSchema.index({ date: 1, optimizer: 1 });
aggCampaignSchema.index({ date: 1, accountId: 1 });
aggCampaignSchema.index({ date: 1, status: 1 }); // 🚀 性能优化：按状态筛选索引
exports.AggCampaign = mongoose_1.default.model('AggCampaign', aggCampaignSchema);
const aggOptimizerSchema = new mongoose_1.Schema({
    date: { type: String, required: true, index: true },
    optimizer: { type: String, required: true, index: true },
    spend: { type: Number, default: 0 },
    revenue: { type: Number, default: 0 },
    roas: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    installs: { type: Number, default: 0 },
    ctr: { type: Number, default: 0 },
    campaigns: { type: Number, default: 0 },
    accounts: { type: Number, default: 0 },
}, { timestamps: true });
aggOptimizerSchema.index({ date: 1, optimizer: 1 }, { unique: true });
exports.AggOptimizer = mongoose_1.default.model('AggOptimizer', aggOptimizerSchema);
// ==================== 导出所有模型 ====================
exports.default = {
    AggDaily: exports.AggDaily,
    AggCountry: exports.AggCountry,
    AggAccount: exports.AggAccount,
    AggCampaign: exports.AggCampaign,
    AggOptimizer: exports.AggOptimizer,
};
