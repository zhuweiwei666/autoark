/**
 * Agent 权责范围 - 只能操作划定的账户和产品
 * 其他的能看、能分析，但不能操作
 */

export interface AgentScope {
  // 可操作的广告账户 ID 列表（空=不限制）
  accountIds: string[]
  // 可操作的产品/包名列表（空=不限制）
  packageNames: string[]
  // 可操作的优化师列表（空=不限制）
  optimizers: string[]
}

// 从环境变量加载，逗号分隔
// 例: AGENT_SCOPE_ACCOUNTS=123456,789012
// 例: AGENT_SCOPE_PACKAGES=com.app1,com.app2
// 例: AGENT_SCOPE_OPTIMIZERS=zhuweiwei,john
function loadScope(): AgentScope {
  const parse = (key: string): string[] => {
    const val = process.env[key] || ''
    return val ? val.split(',').map(s => s.trim()).filter(Boolean) : []
  }
  return {
    accountIds: parse('AGENT_SCOPE_ACCOUNTS'),
    packageNames: parse('AGENT_SCOPE_PACKAGES'),
    optimizers: parse('AGENT_SCOPE_OPTIMIZERS'),
  }
}

let scope: AgentScope = loadScope()

export function getScope(): AgentScope { return scope }

export function setScope(s: Partial<AgentScope>) {
  scope = { ...scope, ...s }
}

/**
 * 检查某个 campaign 是否在 Agent 可操作范围内
 * 返回 true = 可操作，false = 只能看不能动
 */
export function canOperate(campaign: {
  accountId?: string
  pkgName?: string
  optimizer?: string
}): boolean {
  // 如果没有配置任何限制，默认全部不可操作（安全第一）
  if (scope.accountIds.length === 0 && scope.packageNames.length === 0 && scope.optimizers.length === 0) {
    return false
  }

  // 账户限制
  if (scope.accountIds.length > 0 && campaign.accountId) {
    if (!scope.accountIds.includes(campaign.accountId)) return false
  }

  // 包名限制
  if (scope.packageNames.length > 0 && campaign.pkgName) {
    if (!scope.packageNames.some(pkg => campaign.pkgName!.includes(pkg))) return false
  }

  // 优化师限制
  if (scope.optimizers.length > 0 && campaign.optimizer) {
    if (!scope.optimizers.includes(campaign.optimizer)) return false
  }

  return true
}

/**
 * 描述当前权责范围（给 LLM 看）
 */
export function describeScopeForPrompt(): string {
  const parts: string[] = []
  if (scope.accountIds.length > 0) parts.push(`可操作账户: ${scope.accountIds.join(', ')}`)
  if (scope.packageNames.length > 0) parts.push(`可操作产品: ${scope.packageNames.join(', ')}`)
  if (scope.optimizers.length > 0) parts.push(`可操作优化师: ${scope.optimizers.join(', ')}`)
  if (parts.length === 0) return '未配置可操作范围，所有操作需要人工审批。'
  return parts.join('\n') + '\n其他账户/产品只能查看和分析，不能操作。'
}
