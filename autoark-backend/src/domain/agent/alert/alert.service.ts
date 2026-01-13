/**
 * Agent 告警通知服务
 * 处理告警的发送（Webhook、钉钉等渠道）
 */

import axios from 'axios'
import logger from '../../../utils/logger'

export interface AlertConfig {
  enabled: boolean
  channels: Array<{
    type: 'webhook' | 'dingtalk' | 'feishu'
    config: {
      url?: string
      webhook?: string
    }
  }>
}

export interface AlertPayload {
  type: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  value?: number | string
  threshold?: number | string
}

class AlertService {
  /**
   * 发送告警通知
   */
  async sendAlert(alertConfig: AlertConfig, alert: AlertPayload): Promise<void> {
    if (!alertConfig.enabled) return

    for (const channel of alertConfig.channels) {
      try {
        if (channel.type === 'webhook') {
          await this.sendWebhook(channel.config.url!, alert)
        } else if (channel.type === 'dingtalk') {
          await this.sendDingTalk(channel.config, alert)
        }
        // TODO: 其他通知渠道（飞书等）
      } catch (error) {
        logger.error(`[AlertService] Failed to send alert via ${channel.type}:`, error)
      }
    }
  }

  /**
   * 发送 Webhook 通知
   */
  private async sendWebhook(url: string, data: AlertPayload): Promise<void> {
    await axios.post(url, data, { timeout: 10000 })
  }

  /**
   * 发送钉钉通知
   */
  private async sendDingTalk(config: { webhook?: string }, alert: AlertPayload): Promise<void> {
    if (!config.webhook) {
      logger.warn('[AlertService] DingTalk webhook not configured')
      return
    }
    
    const message = {
      msgtype: 'markdown',
      markdown: {
        title: `⚠️ AutoArk 告警`,
        text: `### ${alert.type}\n\n${alert.message}\n\n- 严重程度: ${alert.severity}\n- 当前值: ${alert.value}\n- 阈值: ${alert.threshold}`
      }
    }
    await axios.post(config.webhook, message, { timeout: 10000 })
  }
}

export const alertService = new AlertService()
