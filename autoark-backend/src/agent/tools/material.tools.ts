/**
 * Material Library Tools
 * 
 * Provides agents with access to the creative material library:
 * - Query materials by performance (ROAS, spend, quality score)
 * - Get material details and metrics
 * - Find top performers for creative selection
 */

import { ToolDefinition, AgentContext, ToolResult } from '../core/agent.types'
import Material from '../../models/Material'
import MaterialMetrics from '../../models/MaterialMetrics'
import dayjs from 'dayjs'

const getTopMaterialsTool: ToolDefinition = {
  name: 'get_top_materials',
  description: 'Get the best performing materials (creatives) ranked by ROAS, spend, or quality score. Use this to select creatives for new campaigns.',
  category: 'material',
  parameters: {
    type: 'OBJECT',
    properties: {
      sortBy: {
        type: 'STRING',
        description: 'Sort/rank by metric',
        enum: ['roas', 'spend', 'qualityScore', 'impressions'],
      },
      materialType: {
        type: 'STRING',
        description: 'Filter by material type',
        enum: ['image', 'video', 'all'],
      },
      minSpend: {
        type: 'NUMBER',
        description: 'Minimum total spend (USD) to filter out low-data materials',
      },
      limit: {
        type: 'INTEGER',
        description: 'Number of results (default 20)',
      },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const query: any = { status: 'active' }

    if (context.organizationId) {
      query.organizationId = context.organizationId
    }
    if (args.materialType && args.materialType !== 'all') {
      query.type = args.materialType
    }
    if (args.minSpend) {
      query['metrics.totalSpend'] = { $gte: args.minSpend }
    }

    const sortField = {
      roas: 'metrics.avgRoas',
      spend: 'metrics.totalSpend',
      qualityScore: 'metrics.qualityScore',
      impressions: 'metrics.totalImpressions',
    }[args.sortBy || 'roas'] || 'metrics.avgRoas'

    const materials = await Material.find(query)
      .select('name type storage.url metrics usage fingerprint.pHash')
      .sort({ [sortField]: -1 })
      .limit(args.limit || 20)
      .lean()

    return {
      success: true,
      data: materials.map((m: any) => ({
        id: m._id,
        name: m.name,
        type: m.type,
        url: m.storage?.url,
        metrics: m.metrics,
        usage: m.usage,
      })),
      metadata: { count: materials.length },
    }
  },
}

const getMaterialPerformanceTool: ToolDefinition = {
  name: 'get_material_performance',
  description: 'Get detailed daily performance metrics for a specific material/creative.',
  category: 'material',
  parameters: {
    type: 'OBJECT',
    properties: {
      materialId: { type: 'STRING', description: 'Material ID' },
      startDate: { type: 'STRING', description: 'Start date (YYYY-MM-DD)' },
      endDate: { type: 'STRING', description: 'End date (YYYY-MM-DD)' },
    },
    required: ['materialId'],
  },
  handler: async (args: any, _context: AgentContext): Promise<ToolResult> => {
    const startDate = args.startDate || dayjs().subtract(14, 'day').format('YYYY-MM-DD')
    const endDate = args.endDate || dayjs().format('YYYY-MM-DD')

    const metrics = await MaterialMetrics.find({
      materialId: args.materialId,
      date: { $gte: startDate, $lte: endDate },
    })
      .sort({ date: -1 })
      .lean()

    // Compute trend indicators
    if (metrics.length >= 3) {
      const recent = metrics.slice(0, 3)
      const older = metrics.slice(3, 6)

      const avgRecentRoas =
        recent.reduce((sum: number, m: any) => sum + (m.roas || 0), 0) / recent.length
      const avgOlderRoas =
        older.length > 0
          ? older.reduce((sum: number, m: any) => sum + (m.roas || 0), 0) / older.length
          : avgRecentRoas

      return {
        success: true,
        data: {
          metrics,
          trend: {
            roasTrend: avgRecentRoas > avgOlderRoas ? 'improving' : avgRecentRoas < avgOlderRoas ? 'declining' : 'stable',
            avgRecentRoas: avgRecentRoas.toFixed(2),
            avgOlderRoas: avgOlderRoas.toFixed(2),
          },
        },
      }
    }

    return {
      success: true,
      data: { metrics, trend: { roasTrend: 'insufficient_data' } },
    }
  },
}

const detectCreativeFatigueTool: ToolDefinition = {
  name: 'detect_creative_fatigue',
  description: 'Detect creative fatigue across active materials. Returns materials with declining CTR or ROAS over the past days.',
  category: 'material',
  parameters: {
    type: 'OBJECT',
    properties: {
      daysToAnalyze: {
        type: 'INTEGER',
        description: 'Number of days to analyze (default 14)',
      },
      declineThreshold: {
        type: 'NUMBER',
        description: 'Minimum % decline to flag as fatigued (default 20)',
      },
    },
  },
  handler: async (args: any, context: AgentContext): Promise<ToolResult> => {
    const days = args.daysToAnalyze || 14
    const threshold = args.declineThreshold || 20
    const midPoint = Math.floor(days / 2)

    const startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD')
    const midDate = dayjs().subtract(midPoint, 'day').format('YYYY-MM-DD')
    const endDate = dayjs().format('YYYY-MM-DD')

    // Get materials with enough data
    const query: any = {}
    if (context.organizationId) {
      query.organizationId = context.organizationId
    }

    const activeMaterials = await Material.find({
      ...query,
      status: 'active',
      'metrics.totalSpend': { $gte: 50 },
    })
      .select('_id name type metrics')
      .lean()

    const fatiguedMaterials: any[] = []

    for (const material of activeMaterials) {
      const materialId = (material as any)._id.toString()

      // First half metrics
      const firstHalf = await MaterialMetrics.find({
        materialId,
        date: { $gte: startDate, $lt: midDate },
      }).lean()

      // Second half metrics
      const secondHalf = await MaterialMetrics.find({
        materialId,
        date: { $gte: midDate, $lte: endDate },
      }).lean()

      if (firstHalf.length < 2 || secondHalf.length < 2) continue

      const avgCtrFirst =
        firstHalf.reduce((s: number, m: any) => s + (m.ctr || 0), 0) / firstHalf.length
      const avgCtrSecond =
        secondHalf.reduce((s: number, m: any) => s + (m.ctr || 0), 0) / secondHalf.length

      if (avgCtrFirst > 0) {
        const ctrDecline = ((avgCtrFirst - avgCtrSecond) / avgCtrFirst) * 100
        if (ctrDecline >= threshold) {
          fatiguedMaterials.push({
            materialId,
            name: (material as any).name,
            type: (material as any).type,
            ctrDecline: ctrDecline.toFixed(1) + '%',
            avgCtrFirst: avgCtrFirst.toFixed(3),
            avgCtrSecond: avgCtrSecond.toFixed(3),
            recommendation: 'Consider replacing or refreshing this creative',
          })
        }
      }
    }

    return {
      success: true,
      data: fatiguedMaterials,
      metadata: {
        totalAnalyzed: activeMaterials.length,
        fatigued: fatiguedMaterials.length,
        period: `${startDate} to ${endDate}`,
      },
    }
  },
}

export const materialTools: ToolDefinition[] = [
  getTopMaterialsTool,
  getMaterialPerformanceTool,
  detectCreativeFatigueTool,
]

export default materialTools
