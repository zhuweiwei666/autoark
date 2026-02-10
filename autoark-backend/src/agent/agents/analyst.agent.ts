/**
 * Analyst Agent
 * 
 * Replaces the old LCWTS scoring system with LLM-powered contextual analysis.
 * 
 * Responsibilities:
 * - Monitor campaign/adset/ad performance across all accounts
 * - Detect anomalies (spend spikes, ROAS drops, CTR declines)
 * - Identify winners and losers with nuanced reasoning
 * - Detect creative fatigue
 * - Produce structured recommendations for the Executor
 * 
 * Uses: data tools, material tools, analysis tools
 * Does NOT: modify anything (read-only)
 */

import { v4 as uuidv4 } from 'uuid'
import { runAgentLoop } from '../core/agent.runtime'
import {
  AgentConfig,
  AgentContext,
  AgentRunResult,
  AgentMode,
} from '../core/agent.types'
import dayjs from 'dayjs'

const ANALYST_SYSTEM_PROMPT = `You are an expert advertising performance analyst. Your job is to analyze ad campaign data and produce actionable recommendations.

## Your Role
- You analyze performance data across campaigns, ad sets, ads, and creatives
- You identify winners (high ROAS, scaling potential) and losers (bleeding money, declining performance)
- You detect anomalies and trends that need attention
- You consider context: campaign age, spend volume, seasonal effects, creative fatigue
- You produce SPECIFIC, ACTIONABLE recommendations with clear reasoning

## Analysis Framework
For each entity you analyze, consider:
1. **Performance**: ROAS, CPA, CTR, CPM relative to targets and benchmarks
2. **Trend**: Is it improving, stable, or declining over the past 3-7 days?
3. **Volume**: Enough data to make reliable decisions? (minimum $50 spend)
4. **Lifecycle**: New campaign (< $30 spend) vs mature (> $200 spend)
5. **Creative health**: Is the creative showing fatigue? (declining CTR)

## Recommendation Categories
- **SCALE**: Increase budget for high performers (ROAS > target, stable/improving trend)
- **PAUSE**: Stop bleeding campaigns (ROAS < 0.5 for 3+ days with > $50 spend)
- **REDUCE**: Decrease budget for declining performers (was good, now deteriorating)
- **MONITOR**: New or insufficient-data entities that need more time
- **REFRESH**: Creatives showing fatigue - need replacement
- **RESTRUCTURE**: Campaign structure issues (too broad targeting, wrong objective)

## Output Format
Always end with a structured JSON summary:
\`\`\`json
{
  "overallHealth": "good|warning|critical",
  "totalAnalyzed": <number>,
  "recommendations": [
    {
      "action": "SCALE|PAUSE|REDUCE|MONITOR|REFRESH|RESTRUCTURE",
      "entityType": "campaign|adset|ad|material",
      "entityId": "<id>",
      "entityName": "<name>",
      "priority": "high|medium|low",
      "reason": "<specific reasoning>",
      "suggestedParams": { ... }
    }
  ]
}
\`\`\`

## Rules
- ALWAYS use tools to get real data. Never guess or assume.
- Start by getting a dashboard summary, then drill into accounts, then campaigns.
- Focus on entities with significant spend first.
- Be honest about uncertainty - if there's not enough data, say so.
- Consider the agent's objectives (target ROAS, max CPA) when making recommendations.
`

/**
 * Run the Analyst Agent
 */
export async function runAnalyst(params: {
  agentConfig: AgentConfig
  organizationId?: string
  userId?: string
  userMessage?: string
  fbToken?: string
  tiktokToken?: string
}): Promise<AgentRunResult> {
  const { agentConfig, organizationId, userId, userMessage, fbToken, tiktokToken } = params

  const sessionId = uuidv4()
  const context: AgentContext = {
    agentId: agentConfig.id,
    agentConfig: {
      ...agentConfig,
      role: 'analyst',
    },
    organizationId,
    userId,
    sessionId,
    mode: agentConfig.mode,
    permissions: agentConfig.permissions,
    scope: agentConfig.scope,
    objectives: agentConfig.objectives,
    fbToken,
    tiktokToken,
  }

  const defaultMessage = buildDefaultAnalysisPrompt(agentConfig)

  return runAgentLoop({
    systemPrompt: ANALYST_SYSTEM_PROMPT,
    userMessage: userMessage || defaultMessage,
    context,
    toolFilter: {
      categories: ['data', 'material', 'facebook', 'tiktok'],
      // Only allow read tools for analysis
      toolNames: [
        'query_accounts', 'query_daily_metrics', 'query_dashboard_summary',
        'query_account_performance', 'query_campaign_performance', 'query_country_performance',
        'get_campaign_details', 'get_campaigns', 'get_campaign_insights',
        'get_top_materials', 'get_material_performance', 'detect_creative_fatigue',
        'get_tiktok_campaigns', 'get_tiktok_insights',
      ],
    },
  })
}

function buildDefaultAnalysisPrompt(config: AgentConfig): string {
  const today = dayjs().format('YYYY-MM-DD')
  const weekAgo = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

  return `Analyze the performance of all campaigns in scope for the period ${weekAgo} to ${today}.

Objectives:
- Target ROAS: ${config.objectives.targetRoas || 'not set'}
- Max CPA: ${config.objectives.maxCpa ? '$' + config.objectives.maxCpa : 'not set'}
- Daily budget limit: ${config.objectives.dailyBudgetLimit ? '$' + config.objectives.dailyBudgetLimit : 'not set'}

Steps:
1. Get the dashboard summary for the past 7 days
2. Get per-account performance breakdown
3. Get per-campaign performance, sorted by spend (highest first)
4. For the top spending campaigns, get detailed daily metrics to analyze trends
5. Check for creative fatigue
6. Produce recommendations for each entity that needs action

Focus on actionable insights - what should we scale, pause, reduce, or monitor?`
}

export default runAnalyst
