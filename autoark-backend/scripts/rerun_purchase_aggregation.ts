#!/usr/bin/env ts-node
/**
 * 重跑 Purchase 聚合脚本
 * 
 * 功能：
 * 1. 读取 RawInsights 中的所有数据
 * 2. 使用新的 extractPurchaseValue 函数重新计算 purchase_value
 * 3. 回填到 MetricsDaily
 * 
 * 使用方法：
 * ts-node scripts/rerun_purchase_aggregation.ts [date]
 * 
 * 如果不提供 date，则处理最近 7 天的数据
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import dayjs from 'dayjs'
import { extractPurchaseValue } from '../src/utils/facebookPurchase'
import RawInsights from '../src/models/RawInsights'
import MetricsDaily from '../src/models/MetricsDaily'
import logger from '../src/utils/logger'

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI
    if (!uri) {
      throw new Error('MONGO_URI or MONGODB_URI is not defined')
    }
    await mongoose.connect(uri)
    logger.info('✅ MongoDB Connected')
  } catch (error) {
    logger.error('❌ MongoDB connection error:', error)
    process.exit(1)
  }
}

const rerunPurchaseAggregation = async (targetDate?: string) => {
  await connectDB()

  try {
    // 确定要处理的日期范围
    const dates: string[] = []
    if (targetDate) {
      dates.push(targetDate)
    } else {
      // 处理最近 7 天
      for (let i = 0; i < 7; i++) {
        const date = dayjs().subtract(i, 'day').format('YYYY-MM-DD')
        dates.push(date)
      }
    }

    logger.info(`\n========================================`)
    logger.info(`重跑 Purchase 聚合`)
    logger.info(`处理日期: ${dates.join(', ')}`)
    logger.info(`========================================\n`)

    let totalProcessed = 0
    let totalUpdated = 0
    let totalErrors = 0

    for (const date of dates) {
      logger.info(`\n处理日期: ${date}`)
      logger.info('------------------------------------------------')

      // 1. 读取 RawInsights 数据（只处理 today 和 yesterday，因为这两个会写入 MetricsDaily）
      const rawInsights = await RawInsights.find({
        date: date,
        datePreset: { $in: ['today', 'yesterday'] }
      }).lean()

      logger.info(`找到 ${rawInsights.length} 条 RawInsights 记录`)

      for (const raw of rawInsights) {
        try {
          totalProcessed++

          // 2. 从 raw.action_values 重新提取 purchase_value
          const actionValues = raw.raw?.action_values || raw.action_values || []
          const newPurchaseValue = extractPurchaseValue(actionValues)

          // 3. 如果 purchase_value 有变化，更新 RawInsights
          if (raw.purchase_value !== newPurchaseValue) {
            await RawInsights.updateOne(
              { _id: raw._id },
              { $set: { purchase_value: newPurchaseValue, updatedAt: new Date() } }
            )
            logger.debug(`  RawInsights ${raw._id}: ${raw.purchase_value} → ${newPurchaseValue}`)
          }

          // 4. 更新对应的 MetricsDaily（如果存在）
          if (raw.adId) {
            const metricsDaily = await MetricsDaily.findOne({
              date: date,
              level: 'ad',
              entityId: raw.adId,
              country: raw.country || null
            })

            if (metricsDaily) {
              // 更新 purchase_value
              await MetricsDaily.updateOne(
                { _id: metricsDaily._id },
                {
                  $set: {
                    purchase_value: newPurchaseValue,
                    action_values: actionValues, // 确保 action_values 是最新的
                    updatedAt: new Date()
                  }
                }
              )
              totalUpdated++
              logger.debug(`  MetricsDaily ${metricsDaily._id}: purchase_value 更新为 ${newPurchaseValue}`)
            } else {
              // 如果 MetricsDaily 不存在，可能需要创建（但这里只更新，不创建）
              logger.debug(`  MetricsDaily 不存在，跳过 (adId: ${raw.adId})`)
            }
          }
        } catch (error: any) {
          totalErrors++
          logger.error(`处理 RawInsights ${raw._id} 时出错:`, error.message)
        }
      }
    }

    logger.info(`\n========================================`)
    logger.info(`处理完成`)
    logger.info(`总处理记录: ${totalProcessed}`)
    logger.info(`更新记录: ${totalUpdated}`)
    logger.info(`错误记录: ${totalErrors}`)
    logger.info(`========================================\n`)

    await mongoose.disconnect()
    process.exit(0)
  } catch (error: any) {
    logger.error('重跑聚合失败:', error)
    await mongoose.disconnect()
    process.exit(1)
  }
}

// 从命令行参数获取日期
const targetDate = process.argv[2]
rerunPurchaseAggregation(targetDate)

