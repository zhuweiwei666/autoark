import mongoose from 'mongoose'

/**
 * 预聚合数据模型
 * 用于加速前端数据展示，避免实时聚合计算
 * 由后台定时任务每10分钟刷新
 */

// ==================== 仪表盘汇总 ====================
const dashboardSummarySchema = new mongoose.Schema({
  // 日期（YYYY-MM-DD）
  date: { type: String, required: true, index: true },
  
  // 核心指标
  totalSpend: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },  // purchase_value
  totalImpressions: { type: Number, default: 0 },
  totalClicks: { type: Number, default: 0 },
  totalInstalls: { type: Number, default: 0 },
  totalPurchases: { type: Number, default: 0 },
  
  // 派生指标
  roas: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  cpc: { type: Number, default: 0 },
  cpm: { type: Number, default: 0 },
  cpi: { type: Number, default: 0 },
  
  // 活跃统计
  activeAccounts: { type: Number, default: 0 },
  activeCampaigns: { type: Number, default: 0 },
  activeCountries: { type: Number, default: 0 },
  
  // 更新时间
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true })

dashboardSummarySchema.index({ date: 1 }, { unique: true })

// ==================== 账户汇总 ====================
const accountSummarySchema = new mongoose.Schema({
  date: { type: String, required: true },
  accountId: { type: String, required: true },
  accountName: { type: String },
  
  // 核心指标
  spend: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  installs: { type: Number, default: 0 },
  purchases: { type: Number, default: 0 },
  
  // 派生指标
  roas: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  cpc: { type: Number, default: 0 },
  cpm: { type: Number, default: 0 },
  cpi: { type: Number, default: 0 },
  
  // 活跃统计
  campaignCount: { type: Number, default: 0 },
  
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true })

accountSummarySchema.index({ date: 1, accountId: 1 }, { unique: true })
accountSummarySchema.index({ date: 1, spend: -1 })

// ==================== 国家汇总 ====================
const countrySummarySchema = new mongoose.Schema({
  date: { type: String, required: true },
  country: { type: String, required: true },
  countryName: { type: String },
  
  // 核心指标
  spend: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  installs: { type: Number, default: 0 },
  purchases: { type: Number, default: 0 },
  
  // 派生指标
  roas: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  cpc: { type: Number, default: 0 },
  cpm: { type: Number, default: 0 },
  cpi: { type: Number, default: 0 },
  
  // 活跃统计
  campaignCount: { type: Number, default: 0 },
  accountCount: { type: Number, default: 0 },
  
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true })

countrySummarySchema.index({ date: 1, country: 1 }, { unique: true })
countrySummarySchema.index({ date: 1, spend: -1 })

// ==================== 广告系列汇总 ====================
const campaignSummarySchema = new mongoose.Schema({
  date: { type: String, required: true },
  campaignId: { type: String, required: true },
  campaignName: { type: String },
  accountId: { type: String },
  accountName: { type: String },
  status: { type: String },
  objective: { type: String },
  
  // 核心指标
  spend: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  installs: { type: Number, default: 0 },
  purchases: { type: Number, default: 0 },
  
  // 派生指标
  roas: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  cpc: { type: Number, default: 0 },
  cpm: { type: Number, default: 0 },
  cpi: { type: Number, default: 0 },
  
  // 额外字段（从 raw 提取）
  actions: { type: Object },
  actionValues: { type: Object },
  
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true })

campaignSummarySchema.index({ date: 1, campaignId: 1 }, { unique: true })
campaignSummarySchema.index({ date: 1, spend: -1 })
campaignSummarySchema.index({ date: 1, accountId: 1 })
campaignSummarySchema.index({ campaignId: 1, date: -1 })

// ==================== 素材汇总 ====================
const materialSummarySchema = new mongoose.Schema({
  date: { type: String, required: true },
  materialKey: { type: String, required: true }, // creativeId 或 imageHash/videoId
  materialType: { type: String, enum: ['image', 'video'] },
  materialName: { type: String },
  thumbnailUrl: { type: String },
  localStorageUrl: { type: String },
  
  // 核心指标
  spend: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  installs: { type: Number, default: 0 },
  purchases: { type: Number, default: 0 },
  
  // 派生指标
  roas: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  cpc: { type: Number, default: 0 },
  cpm: { type: Number, default: 0 },
  cpi: { type: Number, default: 0 },
  qualityScore: { type: Number, default: 0 },
  
  // 使用统计
  adCount: { type: Number, default: 0 },
  campaignCount: { type: Number, default: 0 },
  optimizers: [{ type: String }],
  
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true })

materialSummarySchema.index({ date: 1, materialKey: 1 }, { unique: true })
materialSummarySchema.index({ date: 1, spend: -1 })
materialSummarySchema.index({ date: 1, roas: -1 })

// ==================== 预聚合元数据 ====================
const summaryMetaSchema = new mongoose.Schema({
  summaryType: { type: String, required: true, unique: true }, // 'dashboard' | 'account' | 'country' | 'campaign' | 'material'
  lastFullRefresh: { type: Date },
  lastIncrementalRefresh: { type: Date },
  recordCount: { type: Number, default: 0 },
  status: { type: String, enum: ['idle', 'refreshing', 'error'], default: 'idle' },
  lastError: { type: String },
  refreshDurationMs: { type: Number },
}, { timestamps: true })

// 导出模型
export const DashboardSummary = mongoose.model('DashboardSummary', dashboardSummarySchema)
export const AccountSummary = mongoose.model('AccountSummary', accountSummarySchema)
export const CountrySummary = mongoose.model('CountrySummary', countrySummarySchema)
export const CampaignSummary = mongoose.model('CampaignSummary', campaignSummarySchema)
export const MaterialSummary = mongoose.model('MaterialSummary', materialSummarySchema)
export const SummaryMeta = mongoose.model('SummaryMeta', summaryMetaSchema)

