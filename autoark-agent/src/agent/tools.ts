/**
 * 工具注册表 - 管理所有 Agent 工具
 */
import { SchemaType } from '@google/generative-ai'

export interface ToolDef {
  name: string
  description: string
  parameters: any // Gemini function declaration schema
  handler: (args: any, ctx: ToolContext) => Promise<any>
}

export interface ToolContext {
  userId: string
  conversationId: string
  getToken: (platform: 'facebook' | 'tiktok', accountId?: string) => Promise<string | null>
}

class ToolRegistry {
  private tools = new Map<string, ToolDef>()

  register(tool: ToolDef) { this.tools.set(tool.name, tool) }
  registerAll(tools: ToolDef[]) { tools.forEach(t => this.register(t)) }
  get(name: string) { return this.tools.get(name) }
  has(name: string) { return this.tools.has(name) }

  /** 转为 Gemini functionDeclarations 格式 */
  toGeminiDeclarations() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  async execute(name: string, args: any, ctx: ToolContext): Promise<any> {
    const tool = this.tools.get(name)
    if (!tool) return { error: `Tool "${name}" not found` }
    try {
      return await tool.handler(args, ctx)
    } catch (err: any) {
      return { error: err.message }
    }
  }
}

export const registry = new ToolRegistry()

/** Gemini SchemaType 简写 */
export const S = {
  str: (desc: string) => ({ type: SchemaType.STRING, description: desc }),
  num: (desc: string) => ({ type: SchemaType.NUMBER, description: desc }),
  int: (desc: string) => ({ type: SchemaType.INTEGER, description: desc }),
  bool: (desc: string) => ({ type: SchemaType.BOOLEAN, description: desc }),
  arr: (desc: string, items: any) => ({ type: SchemaType.ARRAY, description: desc, items }),
  obj: (desc: string, props: any, req?: string[]) => ({
    type: SchemaType.OBJECT, description: desc, properties: props, ...(req ? { required: req } : {}),
  }),
  enum: (desc: string, values: string[]) => ({ type: SchemaType.STRING, description: desc, enum: values }),
}
