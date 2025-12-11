import cron from 'node-cron'
import logger from '../utils/logger'
import { ruleService } from '../services/rule.service'
import { AutoRule } from '../models/AutoRule'

/**
 * 🤖 规则引擎定时任务
 * 
 * 调度策略：
 * - 每小时执行：所有 schedule.type = 'hourly' 的规则
 * - 每天执行：所有 schedule.type = 'daily' 的规则（北京时间 8:00）
 * - 自定义：根据规则的 cron 表达式执行
 */

export function initRuleCron() {
  // 每小时执行一次（整点）
  cron.schedule('0 * * * *', async () => {
    logger.info('[RuleCron] Running hourly rules...')
    try {
      const hourlyRules = await AutoRule.find({ 
        status: 'active', 
        'schedule.type': 'hourly' 
      })
      
      for (const rule of hourlyRules) {
        try {
          await ruleService.executeRule(rule._id.toString())
        } catch (error: any) {
          logger.error(`[RuleCron] Hourly rule ${rule.name} failed: ${error.message}`)
        }
      }
      
      logger.info(`[RuleCron] Hourly execution completed: ${hourlyRules.length} rules`)
    } catch (error: any) {
      logger.error(`[RuleCron] Hourly execution failed: ${error.message}`)
    }
  })
  
  // 每天早上 8 点执行（北京时间）
  cron.schedule('0 0 * * *', async () => {
    logger.info('[RuleCron] Running daily rules...')
    try {
      const dailyRules = await AutoRule.find({ 
        status: 'active', 
        'schedule.type': 'daily' 
      })
      
      for (const rule of dailyRules) {
        try {
          await ruleService.executeRule(rule._id.toString())
        } catch (error: any) {
          logger.error(`[RuleCron] Daily rule ${rule.name} failed: ${error.message}`)
        }
      }
      
      logger.info(`[RuleCron] Daily execution completed: ${dailyRules.length} rules`)
    } catch (error: any) {
      logger.error(`[RuleCron] Daily execution failed: ${error.message}`)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })
  
  logger.info('[RuleCron] Rule cron initialized (hourly + daily schedules)')
}

export default { initRuleCron }
