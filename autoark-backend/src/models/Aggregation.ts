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

// 判断日期是否在最近 3 天内
export function isRecentDate(date: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const targetDate = new Date(date)
  targetDate.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24))
  return diffDays <= 2 // 今天、昨天、前天
}

import mongoose, { Schema, Document } from 'mongoose'

// ==================== 1. 每日汇总表 (Dashboard) ====================
export interface IAggDaily extends Document {
  date: string                    // YYYY-MM-DD
  spend: number                   // 总消耗
  revenue: number                 // 总收入
  roas: number                    // ROAS
  impressions: number             // 展示量
  clicks: number                  // 点击量
  installs: number                // 安装量
  ctr: number                     // 点击率
  cpm: number                     // 千次展示成本
  cpc: number                     // 单次点击成本
  cpi: number                     // 单次安装成本
  activeCampaigns: number         // 活跃广告系列数
  activeAccounts: number          // 活跃账户数
  dataStatus: 'fresh' | 'stale' | 'partial'
  failedAccounts: number
  cachedAccounts: number
  updatedAt: Date
}

const aggDailySchema = new Schema<IAggDaily>({
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
  dataStatus: {
    type: String,
    enum: ['fresh', 'stale', 'partial'],
    default: 'fresh',
  },
  failedAccounts: { type: Number, default: 0 },
  cachedAccounts: { type: Number, default: 0 },
}, { timestamps: true })

export const AggDaily = mongoose.model<IAggDaily>('AggDaily', aggDailySchema)


// ==================== 2. 分国家表 (国家页面) ====================
export interface IAggCountry extends Document {
  date: string
  country: string                 // 国家代码
  countryName: string             // 国家名称
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
  installs: number
  ctr: number
  campaigns: number               // 广告系列数
  updatedAt: Date
}

const aggCountrySchema = new Schema<IAggCountry>({
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
}, { timestamps: true })

aggCountrySchema.index({ date: 1, country: 1 }, { unique: true })

export const AggCountry = mongoose.model<IAggCountry>('AggCountry', aggCountrySchema)

// 账户维度的国家快照，用于在组织权限范围内安全聚合国家数据。
export interface IAggCountryAccount extends Document {
  date: string
  accountId: string
  country: string
  countryName: string
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
  installs: number
  ctr: number
  campaigns: number
  updatedAt: Date
}

const aggCountryAccountSchema = new Schema<IAggCountryAccount>({
  date: { type: String, required: true, index: true },
  accountId: { type: String, required: true, index: true },
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
}, { timestamps: true })

aggCountryAccountSchema.index(
  { date: 1, accountId: 1, country: 1 },
  { unique: true },
)
aggCountryAccountSchema.index({ date: 1, country: 1 })

export const AggCountryAccount = mongoose.model<IAggCountryAccount>(
  'AggCountryAccount',
  aggCountryAccountSchema,
)


// ==================== 3. 分账户表 (账户页面) ====================
export interface IAggAccount extends Document {
  date: string
  accountId: string
  accountName: string
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
  installs: number
  ctr: number
  campaigns: number               // 广告系列数
  status: string                  // 账户状态
  updatedAt: Date
}

const aggAccountSchema = new Schema<IAggAccount>({
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
}, { timestamps: true })

aggAccountSchema.index({ date: 1, accountId: 1 }, { unique: true })

export const AggAccount = mongoose.model<IAggAccount>('AggAccount', aggAccountSchema)


// ==================== 4. 分广告系列表 (广告系列页面) ====================
export interface IAggCampaign extends Document {
  date: string
  campaignId: string
  campaignName: string
  accountId: string
  accountName: string
  optimizer: string               // 投手（从名称提取）
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
  installs: number
  ctr: number
  cpc: number
  cpi: number
  status: string                  // 广告系列状态
  objective: string               // 优化目标
  updatedAt: Date
}

const aggCampaignSchema = new Schema<IAggCampaign>({
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
}, { timestamps: true })

aggCampaignSchema.index({ date: 1, campaignId: 1 }, { unique: true })
aggCampaignSchema.index({ date: 1, optimizer: 1 })
aggCampaignSchema.index({ date: 1, accountId: 1 })
aggCampaignSchema.index({ date: 1, status: 1 }) // 🚀 性能优化：按状态筛选索引

export const AggCampaign = mongoose.model<IAggCampaign>('AggCampaign', aggCampaignSchema)


// ==================== 5. 分投手表 (投手维度) ====================
export interface IAggOptimizer extends Document {
  date: string
  optimizer: string               // 投手名称
  spend: number
  revenue: number
  roas: number
  impressions: number
  clicks: number
  installs: number
  ctr: number
  campaigns: number               // 广告系列数
  accounts: number                // 账户数
  updatedAt: Date
}

const aggOptimizerSchema = new Schema<IAggOptimizer>({
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
}, { timestamps: true })

aggOptimizerSchema.index({ date: 1, optimizer: 1 }, { unique: true })

export const AggOptimizer = mongoose.model<IAggOptimizer>('AggOptimizer', aggOptimizerSchema)


// ==================== 导出所有模型 ====================
export default {
  AggDaily,
  AggCountry,
  AggCountryAccount,
  AggAccount,
  AggCampaign,
  AggOptimizer,
}
