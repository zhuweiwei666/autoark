/**
 * 异常检测 — 基于历史基线和同组对比
 */
import { AnomalyResult } from './types'
import { RawCampaign } from './data-collector'

interface SamplePoint { spend: number; spendRate: number; roi: number }

/**
 * 检测单个 campaign 的异常
 */
export function detectAnomalies(
  campaign: RawCampaign,
  history: SamplePoint[],   // 过去 24h 的时序
  peers: RawCampaign[],     // 同账户的其他 campaign
  hour: number,
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = []
  const roi = campaign.adjustedRoi || campaign.firstDayRoi || 0

  // 1. 花费飙升（基于自身历史基线）
  if (history.length >= 3 && campaign.spend > 20 && hour > 2) {
    const avgRate = history.reduce((s, h) => s + h.spendRate, 0) / history.length
    const currentRate = campaign.spend / hour
    if (avgRate > 0 && currentRate > avgRate * 2.5) {
      anomalies.push({
        type: 'spend_spike',
        severity: Math.min(5, Math.round(currentRate / avgRate)),
        message: `花费速率 $${currentRate.toFixed(1)}/h 是历史均值 $${avgRate.toFixed(1)}/h 的 ${(currentRate / avgRate).toFixed(1)} 倍`,
      })
    }
  }

  // 2. ROI 暴跌（基于自身历史基线）
  if (history.length >= 3 && campaign.spend > 20) {
    const avgRoi = history.filter(h => h.roi > 0).reduce((s, h) => s + h.roi, 0) /
      Math.max(1, history.filter(h => h.roi > 0).length)
    if (avgRoi > 0.5 && roi < avgRoi * 0.3) {
      anomalies.push({
        type: 'roas_crash',
        severity: Math.min(5, Math.round((1 - roi / avgRoi) * 5)),
        message: `ROI ${roi.toFixed(2)} 从历史均值 ${avgRoi.toFixed(2)} 暴跌 ${((1 - roi / avgRoi) * 100).toFixed(0)}%`,
      })
    }
  }

  // 3. 高花费零转化
  if (campaign.spend > 50 && campaign.installs === 0 && roi === 0 && hour > 4) {
    anomalies.push({
      type: 'zero_conversion',
      severity: Math.min(5, Math.round(campaign.spend / 30)),
      message: `花费 $${campaign.spend.toFixed(0)} 但零安装零收入（${hour.toFixed(0)}h）`,
    })
  }

  // 4. 表现显著低于同组
  if (peers.length >= 3 && campaign.spend > 20) {
    const peerRois = peers.filter(p => p.spend > 20 && p.campaignId !== campaign.campaignId)
      .map(p => p.adjustedRoi || p.firstDayRoi || 0)
      .filter(r => r > 0)
    if (peerRois.length >= 2) {
      const peerAvg = peerRois.reduce((a, b) => a + b, 0) / peerRois.length
      if (peerAvg > 0.3 && roi < peerAvg * 0.3) {
        anomalies.push({
          type: 'underperforming_vs_peers',
          severity: 3,
          message: `ROI ${roi.toFixed(2)} 远低于同账户平均 ${peerAvg.toFixed(2)}`,
        })
      }
    }
  }

  return anomalies
}

/**
 * 检测账户级异常（所有 campaign 同时下跌）
 */
export function detectAccountAnomalies(
  accountId: string,
  campaigns: RawCampaign[],
): AnomalyResult[] {
  const anomalies: AnomalyResult[] = []
  if (campaigns.length < 3) return anomalies

  const withSpend = campaigns.filter(c => c.spend > 10)
  if (withSpend.length < 3) return anomalies

  const allLowRoi = withSpend.every(c => (c.adjustedRoi || c.firstDayRoi || 0) < 0.3)
  if (allLowRoi) {
    anomalies.push({
      type: 'account_wide_decline',
      severity: 4,
      message: `账户 ${accountId} 所有 ${withSpend.length} 个 campaign ROI 都低于 0.3，可能是账户级问题`,
    })
  }

  return anomalies
}
