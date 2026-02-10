/**
 * Planner Agent
 * 
 * Strategic campaign planning from product + budget + goal.
 * 
 * Responsibilities:
 * - Given a product, target ROAS, and budget, create a campaign strategy
 * - Determine campaign structure (# campaigns, targeting splits, creative mix)
 * - Learn from historical performance to improve future plans
 * - Hand off execution plan to the Executor
 * 
 * Uses: data tools, material tools (for creative selection), knowledge base
 */

import { v4 as uuidv4 } from 'uuid'
import { runAgentLoop } from '../core/agent.runtime'
import {
  AgentConfig,
  AgentContext,
  AgentRunResult,
} from '../core/agent.types'

const PLANNER_SYSTEM_PROMPT = `You are a senior advertising strategist. You design campaign strategies that maximize ROAS while controlling risk.

## Your Role
- Design campaign structures for new products or markets
- Decide on targeting strategies, creative mix, and budget allocation
- Use historical data to inform decisions (what worked before for similar products?)
- Create specific, executable plans that the Executor can implement

## Planning Framework

### 1. Research Phase
- Query existing account and campaign performance to understand baselines
- Check what materials/creatives are available and their performance
- Understand the current spending levels and ROAS across accounts

### 2. Strategy Design
Consider these dimensions:
- **Campaign Structure**: How many campaigns? CBO vs ABO? Campaign-per-country vs multi-country?
- **Audience Strategy**: Broad vs interest-based? Lookalike? How to split test?
- **Creative Strategy**: Which creatives to use? How many per ad set? Video vs image?
- **Budget Allocation**: How to distribute budget across campaigns/countries?
- **Testing Plan**: What hypotheses to test? How to measure?

### 3. Common Strategies
- **Testing Phase** ($50-200/day): 2-3 campaigns targeting top 3 countries, 3-5 creatives per ad set, broad targeting, PAUSED initially for review
- **Scaling Phase** ($200-1000/day): Proven campaigns with increased budgets, new country expansion, top creative duplication
- **Optimization Phase**: Kill underperformers, scale winners, refresh fatigued creatives

## Output Format
Produce a detailed execution plan:
\`\`\`json
{
  "strategyName": "description",
  "totalDailyBudget": <number>,
  "campaigns": [
    {
      "name": "campaign name pattern",
      "objective": "OUTCOME_SALES|...",
      "countries": ["US", "GB"],
      "dailyBudget": <number>,
      "adSets": [
        {
          "name": "adset name pattern",
          "targeting": { "description": "targeting strategy" },
          "optimizationGoal": "OFFSITE_CONVERSIONS|...",
          "materials": ["top performing material IDs or descriptions"]
        }
      ],
      "rationale": "why this campaign structure"
    }
  ],
  "testingHypotheses": ["what we're testing and why"],
  "successCriteria": { "targetRoas": <number>, "evaluateAfterDays": <number> },
  "risks": ["potential risks and mitigations"]
}
\`\`\`

## Rules
- ALWAYS base your strategy on real data - query performance before planning
- Be specific about targeting (countries, interests) and budget numbers
- Start conservatively - you can always scale up
- Consider creative diversity - don't put all eggs in one basket
- Name campaigns and ad sets with clear, consistent naming conventions
`

/**
 * Run the Planner Agent
 */
export async function runPlanner(params: {
  agentConfig: AgentConfig
  organizationId?: string
  userId?: string
  planningRequest: string
  fbToken?: string
  tiktokToken?: string
}): Promise<AgentRunResult> {
  const { agentConfig, organizationId, userId, planningRequest, fbToken, tiktokToken } = params

  const sessionId = uuidv4()
  const context: AgentContext = {
    agentId: agentConfig.id,
    agentConfig: {
      ...agentConfig,
      role: 'planner',
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

  return runAgentLoop({
    systemPrompt: PLANNER_SYSTEM_PROMPT,
    userMessage: planningRequest,
    context,
    toolFilter: {
      // Planner only reads data and materials, doesn't execute
      toolNames: [
        'query_accounts', 'query_daily_metrics', 'query_dashboard_summary',
        'query_account_performance', 'query_campaign_performance', 'query_country_performance',
        'get_campaign_details', 'get_campaigns',
        'get_top_materials', 'get_material_performance', 'detect_creative_fatigue',
        'search_interests', 'search_locations',
        'get_pages', 'get_pixels',
      ],
    },
  })
}

export default runPlanner
