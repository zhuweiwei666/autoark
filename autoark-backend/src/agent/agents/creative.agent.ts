/**
 * Creative Agent
 * 
 * Specialized in material/creative optimization.
 * 
 * Responsibilities:
 * - Analyze material performance across campaigns
 * - Detect creative fatigue (declining CTR)
 * - Recommend best creatives for new campaigns
 * - Suggest creative variations and improvements
 * - Build knowledge about what creative styles work
 */

import { v4 as uuidv4 } from 'uuid'
import { runAgentLoop } from '../core/agent.runtime'
import {
  AgentConfig,
  AgentContext,
  AgentRunResult,
} from '../core/agent.types'

const CREATIVE_SYSTEM_PROMPT = `You are a creative performance analyst specializing in ad creatives (images and videos).

## Your Role
- Analyze creative material performance across campaigns and countries
- Detect creative fatigue (declining CTR, increasing CPM)
- Identify top performers and understand why they work
- Recommend which creatives to use for new campaigns
- Suggest when to refresh or retire creatives

## Analysis Dimensions
For each creative, consider:
1. **Performance**: CTR, ROAS, CPA, engagement rate
2. **Trend**: Is performance improving, stable, or declining?
3. **Volume**: Enough impressions/spend to draw conclusions?
4. **Audience fit**: Does it perform differently in different countries?
5. **Fatigue signals**: CTR declining over time? CPM increasing?

## Creative Fatigue Indicators
- CTR declining > 20% over 7-14 days
- CPM increasing > 15% while CTR drops
- Frequency > 3 (same audience seeing the ad too often)
- Performance flat after initial spike

## Recommendations
- **KEEP**: Strong performers with stable or improving trends
- **SCALE**: Top performers that can be expanded to new ad sets/campaigns
- **RETIRE**: Fatigued creatives that should be replaced
- **TEST**: New creatives that need more data
- **REFRESH**: Good concept but needs updated execution

## Output Format
\`\`\`json
{
  "totalMaterialsAnalyzed": <number>,
  "overallCreativeHealth": "healthy|needs_attention|critical",
  "topPerformers": [
    { "materialId": "<id>", "name": "<name>", "roas": <number>, "recommendation": "KEEP|SCALE" }
  ],
  "fatiguedCreatives": [
    { "materialId": "<id>", "name": "<name>", "ctrDecline": "<percent>", "recommendation": "RETIRE|REFRESH" }
  ],
  "recommendations": [
    { "action": "description", "priority": "high|medium|low", "reason": "why" }
  ]
}
\`\`\`
`

/**
 * Run the Creative Agent
 */
export async function runCreativeAgent(params: {
  agentConfig: AgentConfig
  organizationId?: string
  userId?: string
  userMessage?: string
  fbToken?: string
}): Promise<AgentRunResult> {
  const { agentConfig, organizationId, userId, userMessage, fbToken } = params

  const sessionId = uuidv4()
  const context: AgentContext = {
    agentId: agentConfig.id,
    agentConfig: {
      ...agentConfig,
      role: 'creative',
    },
    organizationId,
    userId,
    sessionId,
    mode: agentConfig.mode,
    permissions: agentConfig.permissions,
    scope: agentConfig.scope,
    objectives: agentConfig.objectives,
    fbToken,
  }

  const defaultMessage = `Analyze the creative/material library performance. 
1. Get top performing materials ranked by ROAS (minimum $50 spend)
2. Get top performing materials ranked by spend volume
3. Detect creative fatigue across active materials
4. For the top 5 materials, get their detailed daily performance trends
5. Produce recommendations: which creatives to keep, scale, retire, or refresh`

  return runAgentLoop({
    systemPrompt: CREATIVE_SYSTEM_PROMPT,
    userMessage: userMessage || defaultMessage,
    context,
    toolFilter: {
      categories: ['material', 'data'],
      toolNames: [
        'get_top_materials', 'get_material_performance', 'detect_creative_fatigue',
        'query_campaign_performance', 'query_daily_metrics',
      ],
    },
  })
}

export default runCreativeAgent
