import MetricsDaily from '../models/MetricsDaily'
import RawInsights from '../models/RawInsights'
import OptimizationState from '../models/OptimizationState'
import logger from '../utils/logger'
import mongoose from 'mongoose'

/**
 * 统一写入服务 (Upsert Service)
 * 确保所有写入操作都是幂等的
 */

export interface MetricsDailyInput {
  date: string // YYYY-MM-DD
  level: 'account' | 'campaign' | 'adset' | 'ad'
  entityId: string // accountId / campaignId / adsetId / adId
  channel?: string
  country?: string | null
  
  // 关联 ID
  accountId?: string
  campaignId?: string
  adsetId?: string
  adId?: string

  // 核心指标
  spend: number
  impressions: number
  clicks: number
  purchase_value: number
  roas: number
  
  // 其他指标
  cpc?: number
  ctr?: number
  cpm?: number
  installs?: number
  conversions?: number
  actions?: any
  action_values?: any
  mobile_app_install_count?: number
  
  // 修正相关
  purchase_value_corrected?: number
  purchase_value_last7d?: number
  purchase_correction_applied?: boolean
  purchase_correction_date?: Date
  
  raw?: any
}

export interface RawInsightsInput {
  date: string
  datePreset: string
  adId: string // Raw 数据主要存 Ad 级别
  country?: string | null
  raw: any
  
  // 关键字段提取 (用于快速查询)
  accountId?: string
  campaignId?: string
  adsetId?: string
  spend?: number
  impressions?: number
  clicks?: number
  purchase_value?: number
  syncedAt?: Date
  tokenId?: string
}

export interface OptimizationStateInput {
  entityType: 'account' | 'campaign' | 'adset' | 'ad'
  entityId: string
  accountId: string
  
  currentBudget?: number
  targetRoas?: number
  status?: string
  bidAmount?: number
  
  lastAction?: string
  lastActionTime?: Date
  lastCheckTime?: Date
}

class UpsertService {
  /**
   * 幂等更新 MetricsDaily
   */
  async upsertMetricsDaily(doc: MetricsDailyInput) {
    try {
      // 构建查询条件 (Unique Key)
      const filter: any = {
        date: doc.date,
        entityId: doc.entityId, // 统一使用 entityId 字段查询 (需要在 Schema 中支持或映射)
        level: doc.level
      }
      
      // 如果有 breakdown (如 country)，也要加入 key
      if (doc.country) {
        filter.country = doc.country
      } else {
        filter.country = null
      }

      // 构建更新内容
      const update = {
        $set: {
          channel: doc.channel || 'facebook',
          accountId: doc.accountId,
          campaignId: doc.campaignId,
          adsetId: doc.adsetId,
          adId: doc.adId,
          
          spendUsd: doc.spend, // 注意字段名映射 spend -> spendUsd
          impressions: doc.impressions,
          clicks: doc.clicks,
          purchase_value: doc.purchase_value,
          purchase_roas: doc.roas,
          
          cpc: doc.cpc,
          ctr: doc.ctr,
          cpm: doc.cpm,
          installs: doc.installs,
          conversions: doc.conversions,
          actions: doc.actions,
          action_values: doc.action_values,
          mobile_app_install_count: doc.mobile_app_install_count,
          
          raw: doc.raw,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        }
      }

      // 如果有修正数据，加入 $set
      if (doc.purchase_value_corrected !== undefined) {
        (update.$set as any).purchase_value_corrected = doc.purchase_value_corrected;
        (update.$set as any).purchase_value_last7d = doc.purchase_value_last7d;
        (update.$set as any).purchase_correction_applied = doc.purchase_correction_applied;
        (update.$set as any).purchase_correction_date = doc.purchase_correction_date;
      }

      await MetricsDaily.updateOne(filter, update, { upsert: true })
    } catch (error: any) {
      logger.error(`[UpsertService] Failed to upsert metrics for ${doc.entityId}:`, error)
      throw error
    }
  }

  /**
   * 幂等更新 RawInsights
   */
  async upsertRawInsights(doc: RawInsightsInput) {
    try {
      const filter = {
        adId: doc.adId,
        date: doc.date,
        datePreset: doc.datePreset,
        country: doc.country || null
      }

      const update = {
        $set: {
          raw: doc.raw,
          accountId: doc.accountId,
          campaignId: doc.campaignId,
          adsetId: doc.adsetId,
          spend: doc.spend,
          impressions: doc.impressions,
          clicks: doc.clicks,
          purchase_value: doc.purchase_value,
          syncedAt: doc.syncedAt || new Date(),
          tokenId: doc.tokenId,
          updatedAt: new Date()
        },
        $setOnInsert: {
          channel: 'facebook',
          createdAt: new Date()
        }
      }

      await RawInsights.updateOne(filter, update, { upsert: true })
    } catch (error: any) {
      logger.error(`[UpsertService] Failed to upsert raw insights for ${doc.adId}:`, error)
      throw error
    }
  }

  /**
   * 幂等更新 OptimizationState
   */
  async upsertOptimizationState(doc: OptimizationStateInput) {
    try {
      const filter = {
        entityType: doc.entityType,
        entityId: doc.entityId
      }

      const update = {
        $set: {
          accountId: doc.accountId,
          currentBudget: doc.currentBudget,
          targetRoas: doc.targetRoas,
          status: doc.status,
          bidAmount: doc.bidAmount,
          lastAction: doc.lastAction,
          lastActionTime: doc.lastActionTime,
          lastCheckTime: doc.lastCheckTime || new Date(),
          updatedAt: new Date()
        },
        $setOnInsert: {
          createdAt: new Date()
        }
      }

      await OptimizationState.updateOne(filter, update, { upsert: true })
    } catch (error: any) {
      logger.error(`[UpsertService] Failed to upsert optimization state for ${doc.entityId}:`, error)
      throw error
    }
  }
}

export const upsertService = new UpsertService()

