/**
 * Agent System Entry Point
 * 
 * Initializes the tool registry with all available tools
 * and exports the main agent interfaces.
 */

import logger from '../utils/logger'
import { toolRegistry } from './core/agent.tools'
import { facebookTools } from './tools/facebook.tools'
import { tiktokTools } from './tools/tiktok.tools'
import { dataTools } from './tools/data.tools'
import { materialTools } from './tools/material.tools'

// Re-export core components
export { toolRegistry } from './core/agent.tools'
export { guardrailService } from './core/agent.guardrails'
export { memoryService } from './core/agent.memory'
export { runAgentLoop } from './core/agent.runtime'

// Re-export agents
export { runAnalyst } from './agents/analyst.agent'
export { runExecutor } from './agents/executor.agent'
export { runPlanner } from './agents/planner.agent'
export { runCreativeAgent } from './agents/creative.agent'
export { runOptimizationPipeline, runUserDirected } from './agents/orchestrator'

// Re-export types
export type {
  AgentConfig,
  AgentContext,
  AgentRunResult,
  AgentMode,
  AgentRole,
  AgentStatus,
  AgentPermissions,
  AgentScope,
  AgentObjectives,
  ToolDefinition,
  ToolResult,
} from './core/agent.types'

/**
 * Initialize the agent system.
 * Registers all tools in the global registry.
 * Call this once at application startup.
 */
export function initializeAgentSystem(): void {
  logger.info('[Agent] Initializing agent system...')

  // Register all tools
  toolRegistry.registerAll(facebookTools)
  toolRegistry.registerAll(tiktokTools)
  toolRegistry.registerAll(dataTools)
  toolRegistry.registerAll(materialTools)

  logger.info(
    `[Agent] Agent system initialized. ${toolRegistry.getToolNames().length} tools registered: ${toolRegistry.getToolNames().join(', ')}`
  )
}
