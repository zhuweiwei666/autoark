import { useState, useEffect } from 'react'
import { authFetch, FbAccount } from '../services/api'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from 'recharts'

interface Agent {
  _id: string
  name: string
  description: string
  status: 'active' | 'paused' | 'disabled'
  mode: 'observe' | 'suggest' | 'auto'
  organizationId?: string
  scope: {
    adAccountIds: string[]
    fbTokenIds: string[]
    facebookAppIds: string[]
  }
  objectives: {
    targetRoas: number
    maxCpa?: number
    dailyBudgetLimit?: number
  }
  rules: {
    autoStop: { enabled: boolean; roasThreshold: number; minDays: number; minSpend?: number }
    autoScale: { enabled: boolean; roasThreshold: number; minDays?: number; budgetIncrease: number }
    budgetAdjust: { enabled: boolean; maxAdjustPercent: number; minAdjustPercent?: number }
  }
    scoringConfig: {
      stages: Array<{
        name: string
        minSpend: number
        maxSpend: number
        weights: {
          cpm: number
          ctr: number
          cpc: number
          cpa: number
          roas: number
          hookRate: number
          atcRate: number
        }
      }>
      momentumSensitivity: number
      baselines: {
        cpm: number
        ctr: number
        cpc: number
        hookRate: number
        atcRate: number
      }
    }
    actionThresholds: {
      aggressiveScale: { minScore: number; changePercent: number }
      moderateScale: { minScore: number; changePercent: number }
      stopLoss: { maxScore: number; changePercent: number }
      kill: { maxScore: number }
    }
    feishuConfig?: {
      enabled: boolean
      appId: string
      appSecret: string
      receiveId: string
      receiveIdType: 'open_id' | 'chat_id' | 'user_id' | 'email'
  }
  createdAt: string
}

interface Operation {
  _id: string
  agentId: { name: string }
  accountId: string
  entityType: string
  entityId: string
  entityName: string
  action: string
  beforeValue: any
  afterValue: any
  reason: string
  status: string
  createdAt: string
  scoreSnapshot?: {
    finalScore: number
    baseScore: number
    momentumBonus: number
    stage: string
    metricContributions: Record<string, number>
    slopes: Record<string, number>
  }
}

export default function AgentManagementPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [pendingOps, setPendingOps] = useState<Operation[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'agents' | 'pending' | 'history'>('agents')
  const [showSnapshotModal, setShowSnapshotModal] = useState(false)
  const [selectedOp, setSelectedOp] = useState<Operation | null>(null)
  const [availableAccounts, setAvailableAccounts] = useState<FbAccount[]>([])
  const [tiktokAccounts, setTiktokAccounts] = useState<any[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'paused',
    mode: 'observe',
    organizationId: '',
    scope: {
      adAccountIds: [] as string[],
      fbTokenIds: [] as string[],
      facebookAppIds: [] as string[],
    },
    objectives: { targetRoas: 1.5, maxCpa: 20, dailyBudgetLimit: 500 },
    rules: {
      autoStop: { enabled: true, roasThreshold: 0.5, minDays: 3, minSpend: 50 },
      autoScale: { enabled: true, roasThreshold: 2.0, minDays: 3, budgetIncrease: 0.2 },
      budgetAdjust: { enabled: true, minAdjustPercent: 0.1, maxAdjustPercent: 0.3 },
    },
    aiConfig: { useAiDecision: true, requireApproval: true, approvalThreshold: 100 },
    platform: 'facebook' as 'facebook' | 'tiktok',
    scoringConfig: {
      stages: [
        {
          name: 'Cold Start',
          minSpend: 0,
          maxSpend: 5,
          weights: { cpm: 0.4, ctr: 0.4, hookRate: 0.2, cpc: 0, cpa: 0, roas: 0, atcRate: 0 },
        },
        {
          name: 'Exploration',
          minSpend: 5,
          maxSpend: 30,
          weights: { cpm: 0.1, ctr: 0.1, cpc: 0.1, atcRate: 0.3, cpa: 0.3, roas: 0.1, hookRate: 0 },
        },
        {
          name: 'Scaling',
          minSpend: 30,
          maxSpend: 200,
          weights: { cpm: 0, ctr: 0.1, cpc: 0, atcRate: 0.1, cpa: 0.1, roas: 0.7, hookRate: 0 },
        },
        {
          name: 'Maturity',
          minSpend: 200,
          maxSpend: 999999,
          weights: { cpm: 0.1, ctr: 0.1, cpc: 0, atcRate: 0.1, cpa: 0.1, roas: 0.6, hookRate: 0 },
        },
      ],
      momentumSensitivity: 0.1,
      baselines: { cpm: 20, ctr: 0.01, cpc: 1, hookRate: 0.25, atcRate: 0.05 },
    },
    actionThresholds: {
      aggressiveScale: { minScore: 85, changePercent: 30 },
      moderateScale: { minScore: 70, changePercent: 15 },
      stopLoss: { maxScore: 30, changePercent: -20 },
      kill: { maxScore: 15 },
    },
    feishuConfig: {
      enabled: false,
      appId: '',
      appSecret: '',
      receiveId: '',
      receiveIdType: 'chat_id' as 'open_id' | 'chat_id' | 'user_id' | 'email',
    },
  })

  useEffect(() => {
    loadAgents()
    loadOperations()
    loadPendingOps()
    loadAvailableAccounts()
  }, [])

  const loadAvailableAccounts = async () => {
    setAccountsLoading(true)
    try {
      // 同时拉取 FB 和 TikTok 账户
      const [fbRes, ttRes] = await Promise.all([
        authFetch('/api/bulk-ad/auth/ad-accounts'),
        authFetch('/api/account-management/accounts?channel=tiktok&limit=1000')
      ])
      const fbData = await fbRes.json()
      const ttData = await ttRes.json()
      
      if (fbData.success) {
        setAvailableAccounts(fbData.data || [])
      }
      if (ttData.success) {
        setTiktokAccounts(ttData.data?.list || ttData.data || [])
      }
    } catch (error) {
      console.error('Failed to load accounts:', error)
    } finally {
      setAccountsLoading(false)
    }
  }

  const loadAgents = async () => {
    try {
      const res = await authFetch('/api/agent/agents')
      const data = await res.json()
      if (data.success) setAgents(data.data)
    } catch (error) {
      console.error('Failed to load agents:', error)
    }
  }

  const loadOperations = async () => {
    try {
      const res = await authFetch('/api/agent/operations?limit=50')
      const data = await res.json()
      if (data.success) setOperations(data.data)
    } catch (error) {
      console.error('Failed to load operations:', error)
    }
  }

  const loadPendingOps = async () => {
    try {
      const res = await authFetch('/api/agent/operations/pending')
      const data = await res.json()
      if (data.success) setPendingOps(data.data)
    } catch (error) {
      console.error('Failed to load pending operations:', error)
    }
  }

  const saveAgent = async () => {
    setLoading(true)
    try {
      const url = editingAgent ? `/api/agent/agents/${editingAgent._id}` : '/api/agent/agents'
      const method = editingAgent ? 'PUT' : 'POST'
      
      // 显式序列化，确保嵌套对象 scope 正确传递
      const payload = {
        ...formData,
        // 过滤空字符串 ID
        organizationId: formData.organizationId || undefined,
        // 确保 adAccountIds 是最新的
        scope: {
          ...formData.scope,
          adAccountIds: formData.scope.adAccountIds
        }
      }

      const response = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      
      const resData = await response.json()
      if (resData.success) {
        setShowModal(false)
        loadAgents()
        resetForm()
      } else {
        alert(resData.error || '保存失败')
      }
    } catch (error: any) {
      console.error('Failed to save agent:', error)
      alert(error.message || '保存过程中发生错误')
    }
    setLoading(false)
  }

  const deleteAgent = async (id: string) => {
    if (!confirm('确定要删除这个 Agent 吗？')) return
    try {
      await authFetch(`/api/agent/agents/${id}`, { method: 'DELETE' })
      loadAgents()
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }

  const runAgent = async (id: string) => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/agent/agents/${id}/run`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        alert(`Agent 运行完成，产生 ${data.data.operationsCount} 个操作`)
        loadOperations()
        loadPendingOps()
      }
    } catch (error) {
      console.error('Failed to run agent:', error)
    }
    setLoading(false)
  }

  const runAgentAsJobs = async (id: string) => {
    setLoading(true)
    try {
      const res = await authFetch(`/api/agent/agents/${id}/run-jobs`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        alert(data.data?.message || 'Agent 运行任务已入队')
        loadOperations()
        loadPendingOps()
      } else {
        alert(data.error || '触发失败')
      }
    } catch (error: any) {
      console.error('Failed to run agent as jobs:', error)
      alert(error?.message || '触发失败')
    }
    setLoading(false)
  }

  const openSnapshot = (op: Operation) => {
    setSelectedOp(op)
    setShowSnapshotModal(true)
  }

  const approveOperation = async (id: string) => {
    try {
      await authFetch(`/api/agent/operations/${id}/approve`, { method: 'POST' })
      loadPendingOps()
      loadOperations()
    } catch (error) {
      console.error('Failed to approve operation:', error)
    }
  }

  const rejectOperation = async (id: string) => {
    try {
      await authFetch(`/api/agent/operations/${id}/reject`, { method: 'POST' })
      loadPendingOps()
      loadOperations()
    } catch (error) {
      console.error('Failed to reject operation:', error)
    }
  }

  const resetForm = () => {
    setEditingAgent(null)
    setFormData({
      name: '',
      description: '',
      status: 'paused',
      mode: 'observe',
      organizationId: '',
      scope: {
        adAccountIds: [],
        fbTokenIds: [],
        facebookAppIds: [],
      },
      objectives: { targetRoas: 1.5, maxCpa: 20, dailyBudgetLimit: 500 },
      platform: 'facebook',
      rules: {
        autoStop: { enabled: true, roasThreshold: 0.5, minDays: 3, minSpend: 50 },
        autoScale: { enabled: true, roasThreshold: 2.0, minDays: 3, budgetIncrease: 0.2 },
        budgetAdjust: { enabled: true, minAdjustPercent: 0.1, maxAdjustPercent: 0.3 },
      },
      aiConfig: { useAiDecision: true, requireApproval: true, approvalThreshold: 100 },
      scoringConfig: {
        stages: [
          {
            name: 'Cold Start',
            minSpend: 0,
            maxSpend: 5,
            weights: { cpm: 0.4, ctr: 0.4, hookRate: 0.2, cpc: 0, cpa: 0, roas: 0, atcRate: 0 },
          },
          {
            name: 'Exploration',
            minSpend: 5,
            maxSpend: 30,
            weights: { cpm: 0.1, ctr: 0.1, cpc: 0.1, atcRate: 0.3, cpa: 0.3, roas: 0.1, hookRate: 0 },
          },
          {
            name: 'Scaling',
            minSpend: 30,
            maxSpend: 200,
            weights: { cpm: 0, ctr: 0.1, cpc: 0, atcRate: 0.1, cpa: 0.1, roas: 0.7, hookRate: 0 },
          },
          {
            name: 'Maturity',
            minSpend: 200,
            maxSpend: 999999,
            weights: { cpm: 0.1, ctr: 0.1, cpc: 0, atcRate: 0.1, cpa: 0.1, roas: 0.6, hookRate: 0 },
          },
        ],
        momentumSensitivity: 0.1,
        baselines: { cpm: 20, ctr: 0.01, cpc: 1, hookRate: 0.25, atcRate: 0.05 },
      },
      actionThresholds: {
        aggressiveScale: { minScore: 85, changePercent: 30 },
        moderateScale: { minScore: 70, changePercent: 15 },
        stopLoss: { maxScore: 30, changePercent: -20 },
        kill: { maxScore: 15 },
      },
      feishuConfig: {
        enabled: false,
        appId: '',
        appSecret: '',
        receiveId: '',
        receiveIdType: 'chat_id' as any,
      },
    })
  }

  const editAgent = (agent: Agent) => {
    setEditingAgent(agent)
    setFormData({
      name: agent.name,
      description: agent.description || '',
      status: agent.status,
      mode: agent.mode,
      organizationId: agent.organizationId || '',
      scope: {
        adAccountIds: agent.scope?.adAccountIds || [],
        fbTokenIds: agent.scope?.fbTokenIds || [],
        facebookAppIds: agent.scope?.facebookAppIds || [],
      },
      objectives: {
        targetRoas: agent.objectives?.targetRoas || 1.5,
        maxCpa: agent.objectives?.maxCpa || 20,
        dailyBudgetLimit: agent.objectives?.dailyBudgetLimit || 500,
      },
      platform: (agent as any).platform || 'facebook',
      rules: {
        autoStop: {
          enabled: agent.rules?.autoStop?.enabled ?? true,
          roasThreshold: agent.rules?.autoStop?.roasThreshold || 0.5,
          minDays: agent.rules?.autoStop?.minDays || 3,
          minSpend: agent.rules?.autoStop?.minSpend || 50,
        },
        autoScale: {
          enabled: agent.rules?.autoScale?.enabled ?? true,
          roasThreshold: agent.rules?.autoScale?.roasThreshold || 2.0,
          minDays: agent.rules?.autoScale?.minDays || 3,
          budgetIncrease: agent.rules?.autoScale?.budgetIncrease || 0.2,
        },
        budgetAdjust: {
          enabled: agent.rules?.budgetAdjust?.enabled ?? true,
          minAdjustPercent: agent.rules?.budgetAdjust?.minAdjustPercent || 0.1,
          maxAdjustPercent: agent.rules?.budgetAdjust?.maxAdjustPercent || 0.3,
        },
      },
      aiConfig: (agent as any).aiConfig || formData.aiConfig,
      scoringConfig: agent.scoringConfig || formData.scoringConfig,
      actionThresholds: agent.actionThresholds || formData.actionThresholds,
      feishuConfig: agent.feishuConfig || {
        enabled: false,
        appId: '',
        appSecret: '',
        receiveId: '',
        receiveIdType: 'chat_id' as 'open_id' | 'chat_id' | 'user_id' | 'email',
      },
    })
    setShowModal(true)
  }

  const getModeLabel = (mode: string) => {
    switch (mode) {
      case 'observe': return '观察模式'
      case 'suggest': return '建议模式'
      case 'auto': return '自动模式'
      default: return mode
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-100 text-emerald-700'
      case 'paused': return 'bg-amber-100 text-amber-700'
      case 'disabled': return 'bg-slate-100 text-slate-600'
      default: return ''
    }
  }

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      'pause': '暂停',
      'resume': '恢复',
      'budget_increase': '提高预算',
      'budget_decrease': '降低预算',
      'bid_adjust': '调整出价',
    }
    return labels[action] || action
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <h1 className="text-3xl font-bold text-slate-900">Agent 管理</h1>
          <p className="text-slate-500 mt-1">配置和管理自动化投放代理</p>
        </header>

        {/* Tab 切换 */}
        <div className="flex gap-2">
          {[
            { key: 'agents', label: 'Agent 列表', icon: '🤖', badge: agents.length },
            { key: 'pending', label: '待审批', icon: '⏳', badge: pendingOps.length },
            { key: 'history', label: '操作历史', icon: '📜', badge: 0 },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-6 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {tab.badge > 0 && (
                <span className={`px-2 py-0.5 text-xs rounded-full ${
                  activeTab === tab.key ? 'bg-white/20' : 'bg-slate-200'
                }`}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Agent 列表 */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => { resetForm(); setShowModal(true); }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
              >
                + 创建 Agent
              </button>
            </div>

            {agents.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 shadow-lg shadow-black/5">
                <div className="text-4xl mb-4">🤖</div>
                <p className="text-slate-600">还没有创建任何 Agent</p>
                <p className="text-sm mt-2 text-slate-400">点击上方按钮创建你的第一个自动化投放代理</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {agents.map(agent => (
                  <div key={agent._id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg shadow-black/5">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{agent.name}</h3>
                        <p className="text-sm text-slate-500 mt-1">{agent.description || '无描述'}</p>
                      </div>
                      <span className={`px-3 py-1 rounded-lg text-xs font-medium ${getStatusColor(agent.status)}`}>
                        {agent.status === 'active' ? '运行中' : agent.status === 'paused' ? '已暂停' : '已禁用'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-400 text-xs mb-1">运行模式</div>
                        <div className="text-slate-900 font-medium">{getModeLabel(agent.mode)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-400 text-xs mb-1">目标 ROAS</div>
                        <div className="text-indigo-600 font-medium">{agent.objectives?.targetRoas || '-'}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-400 text-xs mb-1">启用规则</div>
                        <div className="text-slate-900 font-medium">
                          {[
                            agent.rules?.autoStop?.enabled && '关停',
                            agent.rules?.autoScale?.enabled && '扩量',
                            agent.rules?.budgetAdjust?.enabled && '调预算',
                          ].filter(Boolean).join('/') || '无'}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => runAgent(agent._id)}
                        disabled={loading}
                        className="flex-1 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl text-sm font-medium hover:bg-emerald-200 transition-colors"
                      >
                        ▶ 立即运行
                      </button>
                      <button
                        onClick={() => runAgentAsJobs(agent._id)}
                        disabled={loading}
                        className="flex-1 px-4 py-2 bg-indigo-100 text-indigo-700 rounded-xl text-sm font-medium hover:bg-indigo-200 transition-colors"
                      >
                        ⚙︎ 运行(队列)
                      </button>
                      <button
                        onClick={() => editAgent(agent)}
                        className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm hover:bg-slate-200 transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => deleteAgent(agent._id)}
                        className="px-4 py-2 bg-red-100 text-red-600 rounded-xl text-sm hover:bg-red-200 transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 待审批 */}
        {activeTab === 'pending' && (
          <div className="space-y-4">
            {pendingOps.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 shadow-lg shadow-black/5">
                <div className="text-4xl mb-4">✅</div>
                <p className="text-slate-600">没有待审批的操作</p>
              </div>
            ) : (
              pendingOps.map(op => (
                <div key={op._id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg shadow-black/5">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">待审批</span>
                        <span className="text-slate-900 font-medium">{getActionLabel(op.action)}</span>
                      </div>
                      <div className="text-slate-700">{op.entityName || op.entityId}</div>
                      <div className="text-sm text-slate-500 mt-2">{op.reason}</div>
                      {op.beforeValue && op.afterValue && (
                        <div className="text-sm text-slate-400 mt-1">
                          变更: {JSON.stringify(op.beforeValue)} → {JSON.stringify(op.afterValue)}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {op.scoreSnapshot && (
                        <button
                          onClick={() => openSnapshot(op)}
                          className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-medium hover:bg-indigo-100 transition-colors"
                        >
                          👁 决策快照
                        </button>
                      )}
                      <button
                        onClick={() => approveOperation(op._id)}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => rejectOperation(op._id)}
                        className="px-4 py-2 bg-red-100 text-red-600 rounded-xl text-sm hover:bg-red-200 transition-colors"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 操作历史 */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-lg shadow-black/5">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">时间</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">操作</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">对象</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">原因</th>
                  <th className="px-6 py-4 text-left text-sm font-medium text-slate-600">状态</th>
                </tr>
              </thead>
              <tbody>
                {operations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-slate-400">暂无操作记录</td>
                  </tr>
                ) : (
                  operations.map(op => (
                    <tr key={op._id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {new Date(op.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-900">{getActionLabel(op.action)}</td>
                      <td className="px-6 py-4 text-sm text-slate-700">{op.entityName || op.entityId}</td>
                      <td className="px-6 py-4 text-sm text-slate-500 max-w-xs truncate">{op.reason}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          op.status === 'executed' ? 'bg-emerald-100 text-emerald-700' :
                          op.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                          op.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {op.status}
                        </span>
                          {op.scoreSnapshot && (
                            <button
                              onClick={() => openSnapshot(op)}
                              className="text-indigo-600 hover:text-indigo-800"
                              title="查看决策快照"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 创建/编辑 Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4 overflow-y-auto overscroll-contain">
            <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto overscroll-contain shadow-2xl">
              <div className="p-6 border-b border-slate-200">
                <h2 className="text-xl font-semibold text-slate-900">
                  {editingAgent ? '编辑 Agent' : '创建 Agent'}
                </h2>
              </div>

              <div className="p-6 space-y-6">
                {/* 基本信息 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-600 mb-2">名称</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="我的投放 Agent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-600 mb-2">所属平台</label>
                    <select
                      value={formData.platform}
                      onChange={(e) => {
                        const nextPlatform = e.target.value as 'facebook' | 'tiktok'
                        setFormData({ 
                          ...formData, 
                          platform: nextPlatform,
                          scope: { ...formData.scope, adAccountIds: [] } // 切换平台时清空已选账户
                        })
                      }}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="facebook">Facebook</option>
                      <option value="tiktok">TikTok</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="hidden"> {/* 占位，保持原样逻辑 */} </div>
                  <div>
                    <label className="block text-sm text-slate-600 mb-2">状态</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="paused">暂停</option>
                      <option value="active">运行</option>
                      <option value="disabled">禁用</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-600 mb-2 font-bold">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 h-20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="描述这个 Agent 的用途..."
                  />
                </div>

                {/* 账户分配 (Account Scope) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <span className="text-lg">🎯</span>
                      管辖账户 ({formData.platform.toUpperCase()})
                    </label>
                  </div>
                  
                  {accountsLoading ? (
                    <div className="text-center py-4 text-xs text-slate-400">正在同步可用账户...</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 scrollbar-thin">
                      {formData.platform === 'facebook' ? (
                        availableAccounts.map(acc => {
                          const accountId = acc.accountId || acc.id?.replace('act_', '')
                          const isSelected = formData.scope.adAccountIds.includes(accountId)
                          return (
                            <div
                              key={accountId}
                              onClick={() => {
                                const nextIds = isSelected
                                  ? formData.scope.adAccountIds.filter(id => id !== accountId)
                                  : [...formData.scope.adAccountIds, accountId]
                                setFormData({ ...formData, scope: { ...formData.scope, adAccountIds: nextIds } })
                              }}
                              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                                isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-slate-50'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-slate-300'}`}>
                                {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-bold text-slate-800 truncate">{acc.name || accountId}</div>
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">{accountId}</div>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        tiktokAccounts.map(acc => {
                          const isSelected = formData.scope.adAccountIds.includes(acc.accountId)
                          return (
                            <div
                              key={acc.accountId}
                              onClick={() => {
                                const nextIds = isSelected
                                  ? formData.scope.adAccountIds.filter(id => id !== acc.accountId)
                                  : [...formData.scope.adAccountIds, acc.accountId]
                                setFormData({ ...formData, scope: { ...formData.scope, adAccountIds: nextIds } })
                              }}
                              className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                                isSelected ? 'border-pink-500 bg-pink-50' : 'border-slate-100 bg-slate-50'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center ${isSelected ? 'bg-pink-600 border-pink-600' : 'bg-white border-slate-300'}`}>
                                {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-bold text-slate-800 truncate">{acc.name || acc.accountId}</div>
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">{acc.accountId}</div>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3">
                    <p className="text-[10px] text-slate-400 italic">* 已选管辖账户: {formData.scope.adAccountIds.length} 个</p>
                    <button 
                      onClick={() => setFormData({...formData, scope: {...formData.scope, adAccountIds: []}})}
                      className="text-[10px] text-rose-500 font-bold hover:underline"
                    >
                      清空选择
                    </button>
                  </div>
                </div>

                {/* 运行模式 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2">运行模式</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'observe', label: '观察', desc: '仅分析，不操作' },
                      { value: 'suggest', label: '建议', desc: '分析并推送建议' },
                      { value: 'auto', label: '自动', desc: '自动执行优化' },
                    ].map(mode => (
                      <button
                        key={mode.value}
                        onClick={() => setFormData({ ...formData, mode: mode.value })}
                        className={`p-3 rounded-xl border text-left transition-colors ${
                          formData.mode === mode.value
                            ? 'bg-indigo-100 border-indigo-300 text-indigo-900'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <div className="font-medium">{mode.label}</div>
                        <div className="text-xs opacity-70">{mode.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 目标设置 */}
                <div>
                  <label className="block text-sm text-slate-600 mb-2">目标设置</label>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">目标 ROAS</label>
                      <input
                        type="number"
                        step="0.1"
                        value={formData.objectives.targetRoas}
                        onChange={(e) => setFormData({
                          ...formData,
                          objectives: { ...formData.objectives, targetRoas: parseFloat(e.target.value) || 0 }
                        })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">最高 CPA</label>
                      <input
                        type="number"
                        value={formData.objectives.maxCpa}
                        onChange={(e) => setFormData({
                          ...formData,
                          objectives: { ...formData.objectives, maxCpa: parseFloat(e.target.value) || 0 }
                        })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="$"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">日预算上限</label>
                      <input
                        type="number"
                        value={formData.objectives.dailyBudgetLimit}
                        onChange={(e) => setFormData({
                          ...formData,
                          objectives: { ...formData.objectives, dailyBudgetLimit: parseFloat(e.target.value) || 0 }
                        })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="$"
                      />
                    </div>
                  </div>
                </div>

                {/* 自动化规则 */}
                <div className="border-t border-slate-100 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">📈</span>
                    <h3 className="text-lg font-bold text-slate-800">生命周期动量评分配置 (LCWTS)</h3>
                  </div>
                  
                  <div className="space-y-6">
                    {/* 基准值配置 */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                      <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <span className="w-1 h-3 bg-slate-400 rounded-full"></span>
                        评分基准 (Baselines)
                      </h4>
                      <div className="grid grid-cols-3 gap-4">
                <div>
                          <label className="block text-xs text-slate-500 mb-1">CPM 基准 ($)</label>
                          <input
                            type="number"
                            value={formData.scoringConfig.baselines.cpm}
                            onChange={(e) => setFormData({
                              ...formData,
                              scoringConfig: {
                                ...formData.scoringConfig,
                                baselines: { ...formData.scoringConfig.baselines, cpm: parseFloat(e.target.value) || 0 }
                              }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">CTR 基准 (%)</label>
                          <input
                            type="number"
                            step="0.01"
                            value={formData.scoringConfig.baselines.ctr * 100}
                            onChange={(e) => setFormData({
                              ...formData,
                              scoringConfig: {
                                ...formData.scoringConfig,
                                baselines: { ...formData.scoringConfig.baselines, ctr: (parseFloat(e.target.value) || 0) / 100 }
                              }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">CPC 基准 ($)</label>
                        <input
                            type="number"
                            step="0.1"
                            value={formData.scoringConfig.baselines.cpc}
                          onChange={(e) => setFormData({
                            ...formData,
                              scoringConfig: {
                                ...formData.scoringConfig,
                                baselines: { ...formData.scoringConfig.baselines, cpc: parseFloat(e.target.value) || 0 }
                              }
                          })}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm"
                        />
                        </div>
                          <div>
                          <label className="block text-xs text-slate-500 mb-1">Hook Rate 基准 (%)</label>
                          <input
                            type="number"
                            step="1"
                            value={formData.scoringConfig.baselines.hookRate * 100}
                            onChange={(e) => setFormData({
                              ...formData,
                              scoringConfig: {
                                ...formData.scoringConfig,
                                baselines: { ...formData.scoringConfig.baselines, hookRate: (parseFloat(e.target.value) || 0) / 100 }
                              }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1">ATC Rate 基准 (%)</label>
                          <input
                            type="number"
                            step="1"
                            value={formData.scoringConfig.baselines.atcRate * 100}
                            onChange={(e) => setFormData({
                              ...formData,
                              scoringConfig: {
                                ...formData.scoringConfig,
                                baselines: { ...formData.scoringConfig.baselines, atcRate: (parseFloat(e.target.value) || 0) / 100 }
                              }
                            })}
                            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-sm"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 生命周期各阶段权重 */}
                    <div className="space-y-4">
                      {formData.scoringConfig.stages.map((stage, sIdx) => (
                        <div key={stage.name} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:shadow-md transition-all">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center font-bold">
                                {sIdx + 1}
                              </span>
                              <h4 className="font-bold text-slate-800">{stage.name}</h4>
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-slate-400">消耗区间:</span>
                              <input
                                type="number"
                                value={stage.minSpend}
                                onChange={(e) => {
                                  const next = { ...formData.scoringConfig }
                                  next.stages[sIdx].minSpend = parseFloat(e.target.value) || 0
                                  setFormData({ ...formData, scoringConfig: next })
                                }}
                                className="w-16 px-1 py-0.5 border rounded text-center font-mono"
                              />
                              <span className="text-slate-300">-</span>
                              <input
                                type="number"
                                value={stage.maxSpend}
                                onChange={(e) => {
                                  const next = { ...formData.scoringConfig }
                                  next.stages[sIdx].maxSpend = parseFloat(e.target.value) || 0
                                  setFormData({ ...formData, scoringConfig: next })
                                }}
                                className="w-16 px-1 py-0.5 border rounded text-center font-mono"
                              />
                              <span className="text-slate-400">$</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                            {Object.entries(stage.weights).map(([key, weight]) => (
                              <div key={key} className="bg-slate-50 rounded-xl p-2 border border-slate-100">
                                <label className="block text-[10px] text-slate-400 uppercase mb-1 text-center font-bold tracking-tight truncate" title={key}>{key}</label>
                            <input
                              type="number"
                              step="0.1"
                                  min="0"
                                  max="1"
                                  value={weight as number}
                                  onChange={(e) => {
                                    const next = { ...formData.scoringConfig }
                                    ;(next.stages[sIdx].weights as any)[key] = parseFloat(e.target.value) || 0
                                    setFormData({ ...formData, scoringConfig: next })
                                  }}
                                  className="w-full bg-white border border-slate-200 rounded-lg px-1 py-1 text-xs text-center focus:ring-1 focus:ring-indigo-500 font-medium"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                      <div>
                        <div className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          趋势动能敏感度
                        </div>
                        <p className="text-xs text-indigo-600 mt-1 opacity-80">定义指标斜率对分数的加成系数（0.1 = 10% 最高奖金）</p>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={formData.scoringConfig.momentumSensitivity}
                              onChange={(e) => setFormData({
                                ...formData,
                          scoringConfig: { ...formData.scoringConfig, momentumSensitivity: parseFloat(e.target.value) || 0 }
                              })}
                        className="w-20 bg-white border border-indigo-200 rounded-xl px-3 py-2 text-sm text-center font-bold text-indigo-700"
                            />
                          </div>
                  </div>
                </div>

                {/* 评分-操作映射阈值 (Action Thresholds) */}
                <div className="border-t border-slate-100 pt-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">⚡</span>
                    <h3 className="text-lg font-bold text-slate-800">评分-操作映射 (Score-to-Action)</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {/* 扩量设置 */}
                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100 space-y-4">
                      <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wider">激进扩量 (Aggressive)</h4>
                      <div className="grid grid-cols-2 gap-3">
                          <div>
                          <label className="block text-[10px] text-emerald-600 mb-1 font-bold">触发分值 ≥</label>
                            <input
                              type="number"
                            value={formData.actionThresholds.aggressiveScale.minScore}
                              onChange={(e) => setFormData({
                                ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                aggressiveScale: { ...formData.actionThresholds.aggressiveScale, minScore: parseInt(e.target.value) || 0 }
                              }
                              })}
                            className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-1.5 text-sm font-bold text-emerald-700"
                            />
                          </div>
                          <div>
                          <label className="block text-[10px] text-emerald-600 mb-1 font-bold">加价幅度 %</label>
                            <input
                              type="number"
                            value={formData.actionThresholds.aggressiveScale.changePercent}
                              onChange={(e) => setFormData({
                                ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                aggressiveScale: { ...formData.actionThresholds.aggressiveScale, changePercent: parseInt(e.target.value) || 0 }
                              }
                              })}
                            className="w-full bg-white border border-emerald-200 rounded-xl px-3 py-1.5 text-sm font-bold text-emerald-700"
                            />
                          </div>
                        </div>
                    </div>

                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100 space-y-4">
                      <h4 className="text-xs font-bold text-blue-700 uppercase tracking-wider">稳健扩量 (Moderate)</h4>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] text-blue-600 mb-1 font-bold">触发分值 ≥</label>
                          <input
                            type="number"
                            value={formData.actionThresholds.moderateScale.minScore}
                            onChange={(e) => setFormData({
                              ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                moderateScale: { ...formData.actionThresholds.moderateScale, minScore: parseInt(e.target.value) || 0 }
                              }
                            })}
                            className="w-full bg-white border border-blue-200 rounded-xl px-3 py-1.5 text-sm font-bold text-blue-700"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-blue-600 mb-1 font-bold">加价幅度 %</label>
                        <input
                            type="number"
                            value={formData.actionThresholds.moderateScale.changePercent}
                          onChange={(e) => setFormData({
                            ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                moderateScale: { ...formData.actionThresholds.moderateScale, changePercent: parseInt(e.target.value) || 0 }
                              }
                          })}
                            className="w-full bg-white border border-blue-200 rounded-xl px-3 py-1.5 text-sm font-bold text-blue-700"
                        />
                        </div>
                      </div>
                    </div>

                    {/* 止损与关停 */}
                    <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 space-y-4">
                      <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wider">减速止损 (Stop Loss)</h4>
                      <div className="grid grid-cols-2 gap-3">
                          <div>
                          <label className="block text-[10px] text-amber-600 mb-1 font-bold">触发分值 {'<'}</label>
                            <input
                              type="number"
                            value={formData.actionThresholds.stopLoss.maxScore}
                              onChange={(e) => setFormData({
                                ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                stopLoss: { ...formData.actionThresholds.stopLoss, maxScore: parseInt(e.target.value) || 0 }
                              }
                              })}
                            className="w-full bg-white border border-amber-200 rounded-xl px-3 py-1.5 text-sm font-bold text-amber-700"
                            />
                          </div>
                          <div>
                          <label className="block text-[10px] text-amber-600 mb-1 font-bold">降价幅度 %</label>
                            <input
                              type="number"
                            value={formData.actionThresholds.stopLoss.changePercent}
                              onChange={(e) => setFormData({
                                ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                stopLoss: { ...formData.actionThresholds.stopLoss, changePercent: parseInt(e.target.value) || 0 }
                              }
                              })}
                            className="w-full bg-white border border-amber-200 rounded-xl px-3 py-1.5 text-sm font-bold text-amber-700"
                            />
                          </div>
                      </div>
                    </div>

                    <div className="p-4 bg-rose-50 rounded-2xl border border-rose-100 space-y-4">
                      <h4 className="text-xs font-bold text-rose-700 uppercase tracking-wider">立即关停 (Kill)</h4>
                      <div className="grid grid-cols-2 gap-3">
                          <div>
                          <label className="block text-[10px] text-rose-600 mb-1 font-bold">触发分值 {'<'}</label>
                            <input
                              type="number"
                            value={formData.actionThresholds.kill.maxScore}
                              onChange={(e) => setFormData({
                                ...formData,
                              actionThresholds: {
                                ...formData.actionThresholds,
                                kill: { ...formData.actionThresholds.kill, maxScore: parseInt(e.target.value) || 0 }
                              }
                              })}
                            className="w-full bg-white border border-rose-200 rounded-xl px-3 py-1.5 text-sm font-bold text-rose-700"
                            />
                          </div>
                        <div className="flex items-end pb-1.5">
                          <span className="text-[10px] text-rose-400 italic">自动执行 PAUSE</span>
                        </div>
                    </div>
                  </div>
                  </div>
                </div>

                {/* 飞书集成 (Feishu Integration) */}
                <div className="border-t border-slate-100 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">💬</span>
                      <h3 className="text-lg font-bold text-slate-800">飞书审批集成 (Feishu Loop)</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({
                          ...formData,
                          feishuConfig: { ...formData.feishuConfig, enabled: !formData.feishuConfig.enabled }
                        })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.feishuConfig.enabled ? 'bg-blue-600' : 'bg-slate-200'}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${formData.feishuConfig.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </button>
                      <span className="text-sm font-medium text-slate-700">{formData.feishuConfig.enabled ? '已启用' : '已禁用'}</span>
                    </div>
                  </div>

                  {formData.feishuConfig.enabled && (
                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1 font-bold">App ID</label>
                          <input
                            type="text"
                            value={formData.feishuConfig.appId}
                            onChange={(e) => setFormData({
                              ...formData,
                              feishuConfig: { ...formData.feishuConfig, appId: e.target.value }
                            })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm"
                            placeholder="cli_xxxxxxxx"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1 font-bold">App Secret</label>
                          <input
                            type="password"
                            value={formData.feishuConfig.appSecret}
                            onChange={(e) => setFormData({
                              ...formData,
                              feishuConfig: { ...formData.feishuConfig, appSecret: e.target.value }
                            })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm"
                            placeholder="••••••••"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-slate-500 mb-1 font-bold">接收 ID (Receive ID)</label>
                          <input
                            type="text"
                            value={formData.feishuConfig.receiveId}
                            onChange={(e) => setFormData({
                              ...formData,
                              feishuConfig: { ...formData.feishuConfig, receiveId: e.target.value }
                            })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm"
                            placeholder="oc_xxxxxxxx 或 open_id"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500 mb-1 font-bold">ID 类型</label>
                          <select
                            value={formData.feishuConfig.receiveIdType}
                            onChange={(e) => setFormData({
                              ...formData,
                              feishuConfig: { ...formData.feishuConfig, receiveIdType: e.target.value as any }
                            })}
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-sm"
                          >
                            <option value="chat_id">群 ID (chat_id)</option>
                            <option value="open_id">个人 ID (open_id)</option>
                            <option value="user_id">用户 ID (user_id)</option>
                            <option value="email">邮箱 (email)</option>
                          </select>
                        </div>
                      </div>
                      <div className="text-[10px] text-blue-600 bg-blue-50 p-3 rounded-xl border border-blue-100">
                        <strong>💡 配置说明：</strong>
                        <ul className="list-disc list-inside mt-1 space-y-1">
                          <li>请在飞书后台创建“企业自建应用”，开启机器人能力并发布。</li>
                          <li>审批回调地址：<code className="bg-white px-1 rounded">https://app.autoark.work/api/webhooks/feishu/interaction</code></li>
                          <li>确保机器人已加入对应的接收群组。</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50 rounded-b-3xl">
                <button
                  onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-6 py-2 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={saveAgent}
                  disabled={loading || !formData.name}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 决策快照 Modal */}
        {showSnapshotModal && selectedOp && selectedOp.scoreSnapshot && (
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto overscroll-contain">
            <div className="absolute inset-0" onClick={() => setShowSnapshotModal(false)}></div>
            <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-4xl max-h-[90vh] overflow-y-auto overscroll-contain shadow-2xl relative z-10 p-8">
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">决策专家报告 (Decision Snapshot)</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {selectedOp.entityName} <span className="font-mono text-xs ml-2">ID: {selectedOp.entityId}</span>
                  </p>
                </div>
                <button onClick={() => setShowSnapshotModal(false)} className="p-2 rounded-xl hover:bg-slate-100 transition-all">
                  <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* 核心评分概览 */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-indigo-600 rounded-2xl p-5 text-white shadow-lg shadow-indigo-200">
                  <div className="text-xs text-indigo-100 mb-1 opacity-80 uppercase tracking-wider">综合评分</div>
                  <div className="text-4xl font-bold">{selectedOp.scoreSnapshot.finalScore.toFixed(1)}</div>
                  <div className="mt-2 text-xs text-indigo-100 font-medium">Stage: {selectedOp.scoreSnapshot.stage}</div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                  <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">基础评分 (Static)</div>
                  <div className="text-2xl font-bold text-slate-800">{selectedOp.scoreSnapshot.baseScore.toFixed(1)}</div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                  <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">动能奖金 (Trend)</div>
                  <div className={`text-2xl font-bold ${selectedOp.scoreSnapshot.momentumBonus >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {selectedOp.scoreSnapshot.momentumBonus >= 0 ? '+' : ''}
                    {(selectedOp.scoreSnapshot.momentumBonus * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                  <div className="text-xs text-slate-400 mb-1 uppercase tracking-wider">决策时间</div>
                  <div className="text-sm font-medium text-slate-700 mt-2">{new Date(selectedOp.createdAt).toLocaleString()}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 指标贡献权重图 */}
                <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <span className="w-1 h-4 bg-indigo-500 rounded-full"></span>
                    各指标分值贡献 (Weighted Contribution)
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="80%" data={
                        Object.entries(selectedOp.scoreSnapshot.metricContributions || {}).map(([key, val]) => ({
                          subject: key.toUpperCase(),
                          A: val,
                          fullMark: 100,
                        }))
                      }>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="subject" />
                        <Radar name="Score" dataKey="A" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.6} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 指标动能 (斜率) 柱状图 */}
                <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
                    指标动能趋势 (Velocity / Slope)
                  </h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={
                          Object.entries(selectedOp.scoreSnapshot.slopes || {}).map(([key, val]) => ({
                            name: key.toUpperCase(),
                            slope: val,
                          }))
                        }>
                          <XAxis dataKey="name" axisLine={false} tickLine={false} />
                          <YAxis hide />
                          <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: any) => [value.toFixed(4), 'Slope']}
                          />
                          <Bar dataKey="slope" radius={[4, 4, 0, 0]}>
                            {
                              Object.entries(selectedOp.scoreSnapshot.slopes || {}).map((entry, index) => {
                                const val = entry[1]
                                // CTR 升为正，CPA 降为正（在后端已归一化，这里仅展示原始斜率）
                                // 我们简单根据正负涂色
                                return <Cell key={`cell-${index}`} fill={val >= 0 ? '#10b981' : '#f43f5e'} />
                              })
                            }
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  <div className="mt-4 text-xs text-slate-400 text-center italic">
                    * 正值表示指标正在上升，负值表示指标正在下降
                  </div>
                </div>
              </div>

              {/* 决策逻辑解释 */}
              <div className="mt-8 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <span className="w-1 h-4 bg-slate-400 rounded-full"></span>
                  系统决策链摘要
                </h3>
                <div className="text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>1. 当前实体处于 <strong>{selectedOp.scoreSnapshot.stage}</strong> 阶段，系统自动启用了该阶段的权重矩阵。</p>
                  <p>2. 根据元指标表现计算出基础分值为 <strong>{selectedOp.scoreSnapshot.baseScore.toFixed(1)}</strong> 分。</p>
                  <p>3. 综合多维度微分趋势，系统检测到 <strong>{
                    Object.entries(selectedOp.scoreSnapshot.slopes || {})
                      .filter(([_, s]) => Math.abs(s as number) > 0.0001)
                      .map(([k, s]) => `${k.toUpperCase()}(${(s as number) > 0 ? '↗' : '↘'})`)
                      .join(', ') || '指标处于平稳期'
                  }</strong>，提供了 <strong>{(selectedOp.scoreSnapshot.momentumBonus * 100).toFixed(1)}%</strong> 的动能修正。</p>
                  <p className="mt-4 pt-4 border-t border-slate-200 font-medium text-slate-800 italic flex items-center gap-2">
                    <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    最终决定执行: <span className="text-indigo-600 underline underline-offset-4">{selectedOp.action.toUpperCase()}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
