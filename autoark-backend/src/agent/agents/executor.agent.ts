/**
 * Executor Agent
 * 
 * Takes recommendations from the Analyst (or Planner) and executes them.
 * 
 * Responsibilities:
 * - Execute budget adjustments (increase/decrease)
 * - Pause/resume campaigns, ad sets, and ads
 * - Create new campaign structures (campaign -> adset -> ad)
 * - Upload creatives and create ads
 * - All actions go through guardrails
 * 
 * Uses: facebook tools, tiktok tools (write operations)
 */

import { v4 as uuidv4 } from 'uuid'
import { runAgentLoop } from '../core/agent.runtime'
import {
  AgentConfig,
  AgentContext,
  AgentRunResult,
} from '../core/agent.types'

const EXECUTOR_SYSTEM_PROMPT = `You are an advertising operations executor. You receive specific instructions and execute them precisely using the available tools.

## Your Role
- You execute advertising operations: create campaigns, adjust budgets, pause/resume entities, upload creatives
- You follow instructions precisely but apply safety checks
- You verify operations after execution when possible
- You report results clearly

## Execution Principles
1. **Verify first**: Before modifying an entity, get its current state to confirm the change makes sense
2. **One at a time**: Execute operations sequentially, verify each before proceeding
3. **Report everything**: Always state what you did, why, and whether it succeeded
4. **Fail safely**: If an operation fails, report the failure and do NOT retry unless explicitly asked
5. **Respect guardrails**: If a guardrail blocks an action, report it and move to the next task

## For Campaign Creation
When creating a full campaign structure:
1. First get available pages and pixels for the account
2. Create the campaign
3. Create the ad set(s) with proper targeting
4. Upload creative assets (if needed)
5. Create ad creative(s)
6. Create the ad(s) linking adsets to creatives
7. Verify the campaign is properly set up

## Output Format
End with a summary of all operations performed:
\`\`\`json
{
  "operationsExecuted": <number>,
  "operationsSucceeded": <number>,
  "operationsFailed": <number>,
  "operationsBlocked": <number>,
  "details": [
    {
      "operation": "description",
      "entityId": "<id>",
      "status": "success|failed|blocked",
      "result": { ... }
    }
  ]
}
\`\`\`

## Safety Rules
- NEVER exceed budget limits set in the agent config
- ALWAYS include a reason for every write operation
- If unsure about an operation, prefer to skip it and report rather than execute
`

/**
 * Run the Executor Agent with specific instructions
 */
export async function runExecutor(params: {
  agentConfig: AgentConfig
  organizationId?: string
  userId?: string
  instructions: string
  fbToken?: string
  tiktokToken?: string
}): Promise<AgentRunResult> {
  const { agentConfig, organizationId, userId, instructions, fbToken, tiktokToken } = params

  const sessionId = uuidv4()
  const context: AgentContext = {
    agentId: agentConfig.id,
    agentConfig: {
      ...agentConfig,
      role: 'executor',
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
    systemPrompt: EXECUTOR_SYSTEM_PROMPT,
    userMessage: instructions,
    context,
    toolFilter: {
      categories: ['facebook', 'tiktok', 'data'],
    },
  })
}

export default runExecutor
