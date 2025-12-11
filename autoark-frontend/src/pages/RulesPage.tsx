import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

interface Condition {
  metric: string
  operator: string
  value: number
  value2?: number
  timeRange: string
}

interface Rule {
  _id: string
  name: string
  description?: string
  entityLevel: 'campaign' | 'adset' | 'ad'
  conditions: Condition[]
  action: {
    type: string
  }
  schedule: {
    type: string
  }
  limits: {
    maxEntitiesPerExecution?: number
    cooldownMinutes?: number
  }
  status: 'active' | 'paused' | 'draft'
  stats: {
    totalExecutions: number
    lastExecutedAt?: string
    totalEntitiesAffected: number
  }
  executions: Array<{
    executedAt: string
    entitiesChecked: number
    entitiesAffected: number
    details: Array<{
      entityId: string
      entityName: string
      action: string
      success: boolean
      error?: string
    }>
  }>
  createdAt: string
}

interface Template {
  name: string
  description: string
  entityLevel: string
  conditions: Condition[]
  action: { type: string }
  schedule: { type: string }
  limits: any
}

export default function RulesPage() {
  const { token } = useAuth()
  const [rules, setRules] = useState<Rule[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRule, setSelectedRule] = useState<Rule | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  })

  useEffect(() => {
    if (token) {
      loadRules()
      loadTemplates()
    }
  }, [token])

  const loadRules = async () => {
    try {
      const res = await fetch('/api/rules', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) setRules(data.data)
    } catch (error) {
      console.error('Failed to load rules:', error)
    }
    setLoading(false)
  }

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/rules/templates', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) setTemplates(data.data)
    } catch (error) {
      console.error('Failed to load templates:', error)
    }
  }

  const createFromTemplate = async (template: Template) => {
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ...template,
          status: 'draft',
        }),
      })
      const data = await res.json()
      if (data.success) {
        setRules([data.data, ...rules])
        setShowCreateModal(false)
      }
    } catch (error) {
      console.error('Failed to create rule:', error)
    }
  }

  const toggleRule = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/rules/${ruleId}/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        setRules(rules.map(r => r._id === ruleId ? data.data : r))
      }
    } catch (error) {
      console.error('Failed to toggle rule:', error)
    }
  }

  const executeRule = async (ruleId: string) => {
    setExecuting(ruleId)
    try {
      const res = await fetch(`/api/rules/${ruleId}/execute`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        alert(`执行完成！检查 ${data.data.entitiesChecked} 个实体，影响 ${data.data.entitiesAffected} 个`)
        loadRules()
      } else {
        alert(`执行失败: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to execute rule:', error)
    }
    setExecuting(null)
  }

  const deleteRule = async (ruleId: string) => {
    if (!confirm('确定删除这条规则吗？')) return
    try {
      const res = await fetch(`/api/rules/${ruleId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        setRules(rules.filter(r => r._id !== ruleId))
        setSelectedRule(null)
      }
    } catch (error) {
      console.error('Failed to delete rule:', error)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">运行中</span>
      case 'paused':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700">已暂停</span>
      case 'draft':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-700">草稿</span>
      default:
        return null
    }
  }

  const getActionTypeName = (type: string, action?: any) => {
    switch (type) {
      case 'auto_pause': return '🛑 自动暂停'
      case 'auto_enable': return '▶️ 自动启用'
      case 'budget_up': 
        if (action?.budgetChangePercent) return `📈 提升 ${action.budgetChangePercent}% 预算`
        return '📈 提升预算'
      case 'budget_down': 
        if (action?.budgetChangePercent) return `📉 降低 ${action.budgetChangePercent}% 预算`
        return '📉 降低预算'
      case 'alert': return '🔔 发送预警'
      default: return type
    }
  }

  const getEntityLevelName = (level: string) => {
    switch (level) {
      case 'campaign': return '广告系列'
      case 'adset': return '广告组'
      case 'ad': return '广告'
      default: return level
    }
  }

  const getMetricName = (metric: string) => {
    switch (metric) {
      case 'roas': return 'ROAS'
      case 'spend': return '消耗'
      case 'ctr': return 'CTR'
      case 'cpm': return 'CPM'
      case 'impressions': return '展示'
      default: return metric
    }
  }

  const getOperatorSymbol = (op: string) => {
    switch (op) {
      case 'gt': return '>'
      case 'gte': return '≥'
      case 'lt': return '<'
      case 'lte': return '≤'
      case 'eq': return '='
      default: return op
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* 页面标题 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">🤖 自动化规则</h1>
          <p className="text-slate-500 mt-1">配置自动化规则，让系统自动优化广告投放</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + 新建规则
        </button>
      </div>

      {/* 规则列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：规则列表 */}
        <div className="lg:col-span-2 space-y-4">
          {rules.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center">
              <div className="text-4xl mb-4">🤖</div>
              <h3 className="text-lg font-medium text-slate-800 mb-2">还没有规则</h3>
              <p className="text-slate-500 mb-4">点击"新建规则"从模板创建自动化规则</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                + 新建规则
              </button>
            </div>
          ) : (
            rules.map(rule => (
              <div
                key={rule._id}
                onClick={() => setSelectedRule(rule)}
                className={`bg-white rounded-xl shadow-sm p-5 cursor-pointer transition-all hover:shadow-md ${
                  selectedRule?._id === rule._id ? 'ring-2 ring-indigo-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-800">{rule.name}</h3>
                      {getStatusBadge(rule.status)}
                    </div>
                    <p className="text-sm text-slate-500">{rule.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleRule(rule._id) }}
                      className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                        rule.status === 'active' 
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      }`}
                    >
                      {rule.status === 'active' ? '暂停' : '启用'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); executeRule(rule._id) }}
                      disabled={executing === rule._id || rule.status !== 'active'}
                      className="px-3 py-1 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-50"
                    >
                      {executing === rule._id ? '执行中...' : '立即执行'}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded">
                    {getEntityLevelName(rule.entityLevel)}
                  </span>
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded">
                    {getActionTypeName(rule.action.type)}
                  </span>
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded">
                    {rule.schedule.type === 'hourly' ? '每小时' : '每天'}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span>已执行 {rule.stats.totalExecutions} 次，影响 {rule.stats.totalEntitiesAffected} 个实体</span>
                  {rule.stats.lastExecutedAt && (
                    <span>上次执行: {new Date(rule.stats.lastExecutedAt).toLocaleString()}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* 右侧：规则详情 */}
        <div className="lg:col-span-1">
          {selectedRule ? (
            <div className="bg-white rounded-xl shadow-sm p-5 sticky top-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-800">规则详情</h3>
                <button
                  onClick={() => deleteRule(selectedRule._id)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  删除
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-slate-600 mb-2">触发条件</h4>
                  <div className="space-y-2">
                    {selectedRule.conditions.map((cond, i) => (
                      <div key={i} className="px-3 py-2 bg-slate-50 rounded-lg text-sm">
                        {getMetricName(cond.metric)} {getOperatorSymbol(cond.operator)} {cond.value}
                        <span className="text-slate-400 ml-2">({cond.timeRange})</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-600 mb-2">最近执行记录</h4>
                  {selectedRule.executions.length === 0 ? (
                    <p className="text-sm text-slate-400">暂无执行记录</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {selectedRule.executions.slice(0, 10).map((exec, i) => (
                        <div key={i} className="px-3 py-2 bg-slate-50 rounded-lg text-xs">
                          <div className="flex justify-between text-slate-600">
                            <span>{new Date(exec.executedAt).toLocaleString()}</span>
                            <span>{exec.entitiesAffected}/{exec.entitiesChecked}</span>
                          </div>
                          {exec.details.slice(0, 3).map((d, j) => (
                            <div key={j} className={`mt-1 ${d.success ? 'text-emerald-600' : 'text-red-500'}`}>
                              {d.success ? '✓' : '✗'} {d.entityName}
                            </div>
                          ))}
                          {exec.details.length > 3 && (
                            <div className="text-slate-400 mt-1">...还有 {exec.details.length - 3} 个</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-5 text-center text-slate-400">
              选择一条规则查看详情
            </div>
          )}
        </div>
      </div>

      {/* 创建规则模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-800">选择规则模板</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {templates.map((template, i) => (
                <div
                  key={i}
                  onClick={() => createFromTemplate(template)}
                  className="p-4 border border-slate-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 cursor-pointer transition-all"
                >
                  <h3 className="font-semibold text-slate-800 mb-1">{template.name}</h3>
                  <p className="text-sm text-slate-500 mb-3">{template.description}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded">
                      {getEntityLevelName(template.entityLevel)}
                    </span>
                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded">
                      {getActionTypeName(template.action.type)}
                    </span>
                    {template.conditions.map((cond, j) => (
                      <span key={j} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded">
                        {getMetricName(cond.metric)} {getOperatorSymbol(cond.operator)} {cond.value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
