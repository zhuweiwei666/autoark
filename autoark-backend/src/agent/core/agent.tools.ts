/**
 * Agent Tool Registry
 * 
 * Central registry for all agent tools. Handles:
 * - Tool registration and lookup
 * - Converting tool definitions to Gemini function declarations
 * - Tool execution with validation and logging
 */

import logger from '../../utils/logger'
import {
  ToolDefinition,
  ToolResult,
  FunctionDeclaration,
  AgentContext,
  ToolCallRecord,
} from './agent.types'

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map()

  /**
   * Register a single tool
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn(`[ToolRegistry] Overwriting existing tool: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
    logger.debug(`[ToolRegistry] Registered tool: ${tool.name} (${tool.category})`)
  }

  /**
   * Register multiple tools at once
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
    logger.info(`[ToolRegistry] Registered ${tools.length} tools. Total: ${this.tools.size}`)
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Get all registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * Get tools filtered by category
   */
  getByCategory(category: ToolDefinition['category']): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.category === category)
  }

  /**
   * Convert all registered tools to Gemini function declarations.
   * Optionally filter by category or tool names.
   */
  toFunctionDeclarations(filter?: {
    categories?: ToolDefinition['category'][]
    toolNames?: string[]
  }): FunctionDeclaration[] {
    let tools = Array.from(this.tools.values())

    if (filter?.categories) {
      tools = tools.filter(t => filter.categories!.includes(t.category))
    }
    if (filter?.toolNames) {
      tools = tools.filter(t => filter.toolNames!.includes(t.name))
    }

    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }

  /**
   * Execute a tool by name with arguments and context.
   * Returns a ToolCallRecord with timing and results.
   */
  async execute(
    toolName: string,
    args: Record<string, any>,
    context: AgentContext
  ): Promise<{ result: ToolResult; record: ToolCallRecord }> {
    const tool = this.tools.get(toolName)
    if (!tool) {
      const result: ToolResult = {
        success: false,
        error: `Tool "${toolName}" not found. Available tools: ${this.getToolNames().join(', ')}`,
      }
      const record: ToolCallRecord = {
        toolName,
        args,
        result,
        guardrailCheck: { approved: false, reason: 'Tool not found' },
        durationMs: 0,
        timestamp: new Date(),
      }
      return { result, record }
    }

    const startTime = Date.now()
    try {
      logger.info(`[ToolRegistry] Executing tool: ${toolName}`, { args: summarizeArgs(args) })
      const result = await tool.handler(args, context)
      const durationMs = Date.now() - startTime

      logger.info(`[ToolRegistry] Tool ${toolName} completed in ${durationMs}ms`, {
        success: result.success,
      })

      const record: ToolCallRecord = {
        toolName,
        args,
        result,
        guardrailCheck: { approved: true },
        durationMs,
        timestamp: new Date(),
      }

      return { result, record }
    } catch (error: any) {
      const durationMs = Date.now() - startTime
      logger.error(`[ToolRegistry] Tool ${toolName} failed after ${durationMs}ms:`, error.message)

      const result: ToolResult = {
        success: false,
        error: `Tool execution failed: ${error.message}`,
      }
      const record: ToolCallRecord = {
        toolName,
        args,
        result,
        guardrailCheck: { approved: true },
        durationMs,
        timestamp: new Date(),
      }

      return { result, record }
    }
  }
}

/**
 * Summarize tool args for logging (truncate long values)
 */
function summarizeArgs(args: Record<string, any>): Record<string, any> {
  const summary: Record<string, any> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 200) {
      summary[key] = value.substring(0, 200) + '...'
    } else if (typeof value === 'object' && value !== null) {
      const str = JSON.stringify(value)
      summary[key] = str.length > 200 ? str.substring(0, 200) + '...' : value
    } else {
      summary[key] = value
    }
  }
  return summary
}

// Singleton registry
export const toolRegistry = new ToolRegistry()
export default toolRegistry
