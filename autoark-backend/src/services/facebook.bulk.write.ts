import MetricsDaily from '../models/MetricsDaily'
import RawInsights from '../models/RawInsights'
import logger from '../utils/logger'
import mongoose from 'mongoose'

/**
 * 批量写入服务
 * 使用 BulkWrite 提升写入性能（5x 提升）
 */
class BulkWriteService {
  private metricsBulkOps: mongoose.mongo.AnyBulkWriteOperation[] = []
  private rawInsightsBulkOps: mongoose.mongo.AnyBulkWriteOperation[] = []
  private readonly BATCH_SIZE = 500

  /**
   * 添加 MetricsDaily 写入操作
   */
  addMetricsOperation(operation: mongoose.mongo.AnyBulkWriteOperation<MetricsDaily>) {
    this.metricsBulkOps.push(operation)

    // 达到批次大小时自动执行
    if (this.metricsBulkOps.length >= this.BATCH_SIZE) {
      return this.flushMetrics()
    }

    return Promise.resolve()
  }

  /**
   * 添加 RawInsights 写入操作
   */
  addRawInsightsOperation(operation: mongoose.mongo.AnyBulkWriteOperation<RawInsights>) {
    this.rawInsightsBulkOps.push(operation)

    // 达到批次大小时自动执行
    if (this.rawInsightsBulkOps.length >= this.BATCH_SIZE) {
      return this.flushRawInsights()
    }

    return Promise.resolve()
  }

  /**
   * 执行 MetricsDaily 批量写入
   */
  async flushMetrics() {
    if (this.metricsBulkOps.length === 0) {
      return { insertedCount: 0, modifiedCount: 0 }
    }

    try {
      const result = await MetricsDaily.bulkWrite(this.metricsBulkOps, {
        ordered: false, // 不按顺序执行，提高性能
      })
      
      const count = this.metricsBulkOps.length
      this.metricsBulkOps = []
      
      logger.debug(`[BulkWrite] MetricsDaily: ${count} operations executed`)
      return {
        insertedCount: result.insertedCount || 0,
        modifiedCount: result.modifiedCount || 0,
        matchedCount: result.matchedCount || 0,
      }
    } catch (error: any) {
      logger.error('[BulkWrite] MetricsDaily failed:', error)
      // 清空操作列表，避免重复执行
      this.metricsBulkOps = []
      throw error
    }
  }

  /**
   * 执行 RawInsights 批量写入
   */
  async flushRawInsights() {
    if (this.rawInsightsBulkOps.length === 0) {
      return { insertedCount: 0, modifiedCount: 0 }
    }

    try {
      const result = await RawInsights.bulkWrite(this.rawInsightsBulkOps, {
        ordered: false, // 不按顺序执行，提高性能
      })
      
      const count = this.rawInsightsBulkOps.length
      this.rawInsightsBulkOps = []
      
      logger.debug(`[BulkWrite] RawInsights: ${count} operations executed`)
      return {
        insertedCount: result.insertedCount || 0,
        modifiedCount: result.modifiedCount || 0,
        matchedCount: result.matchedCount || 0,
      }
    } catch (error: any) {
      logger.error('[BulkWrite] RawInsights failed:', error)
      // 清空操作列表，避免重复执行
      this.rawInsightsBulkOps = []
      throw error
    }
  }

  /**
   * 执行所有待处理的批量写入
   */
  async flushAll() {
    const [metricsResult, rawInsightsResult] = await Promise.all([
      this.flushMetrics(),
      this.flushRawInsights(),
    ])

    return {
      metrics: metricsResult,
      rawInsights: rawInsightsResult,
    }
  }

  /**
   * 获取待处理操作数量
   */
  getPendingCount() {
    return {
      metrics: this.metricsBulkOps.length,
      rawInsights: this.rawInsightsBulkOps.length,
    }
  }
}

// 单例模式
export const bulkWriteService = new BulkWriteService()

/**
 * 辅助函数：创建 updateOne 操作
 */
export const createUpdateOneOperation = (
  filter: any,
  update: any,
  options: { upsert?: boolean } = {}
): mongoose.mongo.AnyBulkWriteOperation => {
  return {
    updateOne: {
      filter,
      update: {
        $set: update,
        $unset: update.$unset || {},
      },
      upsert: options.upsert !== false,
    },
  }
}

