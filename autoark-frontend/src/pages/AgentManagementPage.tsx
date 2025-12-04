import { useState, useEffect } from 'react'

interface Agent {
  _id: string
  name: string
  description: string
  status: 'active' | 'paused' | 'disabled'
  mode: 'observe' | 'suggest' | 'auto'
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
}

export default function AgentManagementPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [operations, setOperations] = useState<Operation[]>([])
  const [pendingOps, setPendingOps] = useState<Operation[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'agents' | 'pending' | 'history'>('agents')

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    status: 'paused',
    mode: 'observe',
    objectives: { targetRoas: 1.5, maxCpa: 0, dailyBudgetLimit: 0 },
    rules: {
      autoStop: { enabled: true, roasThreshold: 0.5, minDays: 3, minSpend: 50 },
      autoScale: { enabled: true, roasThreshold: 2.0, minDays: 3, budgetIncrease: 0.2 },
      budgetAdjust: { enabled: true, minAdjustPercent: 0.1, maxAdjustPercent: 0.3 },
    },
    aiConfig: { useAiDecision: true, requireApproval: true, approvalThreshold: 100 },
  })

  useEffect(() => {
    loadAgents()
    loadOperations()
    loadPendingOps()
  }, [])

  const loadAgents = async () => {
    try {
      const res = await fetch('/api/agent/agents')
      const data = await res.json()
      if (data.success) setAgents(data.data)
    } catch (error) {
      console.error('Failed to load agents:', error)
    }
  }

  const loadOperations = async () => {
    try {
      const res = await fetch('/api/agent/operations?limit=50')
      const data = await res.json()
      if (data.success) setOperations(data.data)
    } catch (error) {
      console.error('Failed to load operations:', error)
    }
  }

  const loadPendingOps = async () => {
    try {
      const res = await fetch('/api/agent/operations/pending')
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
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      
      if ((await res.json()).success) {
        setShowModal(false)
        loadAgents()
        resetForm()
      }
    } catch (error) {
      console.error('Failed to save agent:', error)
    }
    setLoading(false)
  }

  const deleteAgent = async (id: string) => {
    if (!confirm('确定要删除这个 Agent 吗？')) return
    try {
      await fetch(`/api/agent/agents/${id}`, { method: 'DELETE' })
      loadAgents()
    } catch (error) {
      console.error('Failed to delete agent:', error)
    }
  }

  const runAgent = async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/agent/agents/${id}/run`, { method: 'POST' })
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

  const approveOperation = async (id: string) => {
    try {
      await fetch(`/api/agent/operations/${id}/approve`, { method: 'POST' })
      loadPendingOps()
      loadOperations()
    } catch (error) {
      console.error('Failed to approve operation:', error)
    }
  }

  const rejectOperation = async (id: string) => {
    try {
      await fetch(`/api/agent/operations/${id}/reject`, { method: 'POST' })
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
      objectives: { targetRoas: 1.5, maxCpa: 0, dailyBudgetLimit: 0 },
      rules: {
        autoStop: { enabled: true, roasThreshold: 0.5, minDays: 3, minSpend: 50 },
        autoScale: { enabled: true, roasThreshold: 2.0, minDays: 3, budgetIncrease: 0.2 },
        budgetAdjust: { enabled: true, minAdjustPercent: 0.1, maxAdjustPercent: 0.3 },
      },
      aiConfig: { useAiDecision: true, requireApproval: true, approvalThreshold: 100 },
    })
  }

  const editAgent = (agent: Agent) => {
    setEditingAgent(agent)
    setFormData({
      name: agent.name,
      description: agent.description || '',
      status: agent.status,
      mode: agent.mode,
      objectives: {
        targetRoas: agent.objectives?.targetRoas || 1.5,
        maxCpa: agent.objectives?.maxCpa || 0,
        dailyBudgetLimit: agent.objectives?.dailyBudgetLimit || 0,
      },
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
      aiConfig: formData.aiConfig,
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
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          op.status === 'executed' ? 'bg-emerald-100 text-emerald-700' :
                          op.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                          op.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {op.status}
                        </span>
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
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
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
                    <label className="block text-sm text-slate-600 mb-2">状态</label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="paused">暂停</option>
                      <option value="active">运行</option>
                      <option value="disabled">禁用</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-slate-600 mb-2">描述</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-slate-900 h-20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="描述这个 Agent 的用途..."
                  />
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
                <div>
                  <label className="block text-sm text-slate-600 mb-2">自动化规则</label>
                  <div className="space-y-3">
                    {/* 自动关停 */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <label className="flex items-center justify-between">
                        <div>
                          <div className="text-slate-900 font-medium">自动关停</div>
                          <div className="text-xs text-slate-400">ROAS 过低时自动暂停广告</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={formData.rules.autoStop.enabled}
                          onChange={(e) => setFormData({
                            ...formData,
                            rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, enabled: e.target.checked } }
                          })}
                          className="w-5 h-5 rounded text-indigo-600"
                        />
                      </label>
                      {formData.rules.autoStop.enabled && (
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <div>
                            <label className="text-xs text-slate-400">ROAS 阈值</label>
                            <input
                              type="number"
                              step="0.1"
                              value={formData.rules.autoStop.roasThreshold}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, roasThreshold: parseFloat(e.target.value) } }
                              })}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400">连续天数</label>
                            <input
                              type="number"
                              value={formData.rules.autoStop.minDays}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, minDays: parseInt(e.target.value) } }
                              })}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400">最小消耗 $</label>
                            <input
                              type="number"
                              value={formData.rules.autoStop.minSpend}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, minSpend: parseFloat(e.target.value) } }
                              })}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 自动扩量 */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                      <label className="flex items-center justify-between">
                        <div>
                          <div className="text-slate-900 font-medium">自动扩量</div>
                          <div className="text-xs text-slate-400">ROAS 优秀时自动提升预算</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={formData.rules.autoScale.enabled}
                          onChange={(e) => setFormData({
                            ...formData,
                            rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, enabled: e.target.checked } }
                          })}
                          className="w-5 h-5 rounded text-indigo-600"
                        />
                      </label>
                      {formData.rules.autoScale.enabled && (
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <div>
                            <label className="text-xs text-slate-400">ROAS 阈值</label>
                            <input
                              type="number"
                              step="0.1"
                              value={formData.rules.autoScale.roasThreshold}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, roasThreshold: parseFloat(e.target.value) } }
                              })}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400">连续天数</label>
                            <input
                              type="number"
                              value={formData.rules.autoScale.minDays}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, minDays: parseInt(e.target.value) } }
                              })}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-slate-400">提升比例 %</label>
                            <input
                              type="number"
                              value={formData.rules.autoScale.budgetIncrease * 100}
                              onChange={(e) => setFormData({
                                ...formData,
                                rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, budgetIncrease: parseFloat(e.target.value) / 100 } }
                              })}
                              className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-slate-900 text-sm"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
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
      </div>
    </div>
  )
}
