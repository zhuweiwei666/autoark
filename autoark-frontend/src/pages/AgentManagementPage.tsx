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
      case 'active': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      case 'paused': return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      case 'disabled': return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
          Agent 管理
        </h1>
        <p className="text-slate-400 mt-2">配置和管理自动化投放代理</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'agents', label: 'Agent 列表', icon: '🤖', badge: agents.length },
          { key: 'pending', label: '待审批', icon: '⏳', badge: pendingOps.length },
          { key: 'history', label: '操作历史', icon: '📜', badge: 0 },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-6 py-3 rounded-2xl font-medium transition-all flex items-center gap-2 ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border border-white/20'
                : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-transparent'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
            {tab.badge > 0 && (
              <span className="px-2 py-0.5 text-xs bg-white/20 rounded-full">{tab.badge}</span>
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
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity"
            >
              + 创建 Agent
            </button>
          </div>

          {agents.length === 0 ? (
            <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-12 text-center text-slate-500">
              <div className="text-4xl mb-4">🤖</div>
              <p>还没有创建任何 Agent</p>
              <p className="text-sm mt-2">点击上方按钮创建你的第一个自动化投放代理</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {agents.map(agent => (
                <div key={agent._id} className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white">{agent.name}</h3>
                      <p className="text-sm text-slate-400 mt-1">{agent.description || '无描述'}</p>
                    </div>
                    <div className="flex gap-2">
                      <span className={`px-3 py-1 rounded-lg text-xs border ${getStatusColor(agent.status)}`}>
                        {agent.status === 'active' ? '运行中' : agent.status === 'paused' ? '已暂停' : '已禁用'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                    <div className="bg-white/5 rounded-xl p-3">
                      <div className="text-slate-400 text-xs mb-1">运行模式</div>
                      <div className="text-white">{getModeLabel(agent.mode)}</div>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3">
                      <div className="text-slate-400 text-xs mb-1">目标 ROAS</div>
                      <div className="text-cyan-400">{agent.objectives?.targetRoas || '-'}</div>
                    </div>
                    <div className="bg-white/5 rounded-xl p-3">
                      <div className="text-slate-400 text-xs mb-1">启用规则</div>
                      <div className="text-white">
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
                      className="flex-1 px-4 py-2 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-emerald-400 rounded-xl text-sm font-medium hover:from-emerald-500/30 hover:to-cyan-500/30 transition-colors border border-emerald-500/20"
                    >
                      ▶ 立即运行
                    </button>
                    <button
                      onClick={() => editAgent(agent)}
                      className="px-4 py-2 bg-white/5 text-slate-300 rounded-xl text-sm hover:bg-white/10 transition-colors"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => deleteAgent(agent._id)}
                      className="px-4 py-2 bg-red-500/10 text-red-400 rounded-xl text-sm hover:bg-red-500/20 transition-colors"
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
            <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-12 text-center text-slate-500">
              <div className="text-4xl mb-4">✅</div>
              <p>没有待审批的操作</p>
            </div>
          ) : (
            pendingOps.map(op => (
              <div key={op._id} className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-1 bg-amber-500/20 text-amber-400 rounded text-xs">待审批</span>
                      <span className="text-white font-medium">{getActionLabel(op.action)}</span>
                    </div>
                    <div className="text-slate-300">{op.entityName || op.entityId}</div>
                    <div className="text-sm text-slate-400 mt-2">{op.reason}</div>
                    {op.beforeValue && op.afterValue && (
                      <div className="text-sm text-slate-500 mt-1">
                        变更: {JSON.stringify(op.beforeValue)} → {JSON.stringify(op.afterValue)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveOperation(op._id)}
                      className="px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-colors"
                    >
                      批准
                    </button>
                    <button
                      onClick={() => rejectOperation(op._id)}
                      className="px-4 py-2 bg-red-500/20 text-red-400 rounded-xl text-sm hover:bg-red-500/30 transition-colors"
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
        <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">时间</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">操作</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">对象</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">原因</th>
                <th className="px-6 py-4 text-left text-sm font-medium text-slate-400">状态</th>
              </tr>
            </thead>
            <tbody>
              {operations.map(op => (
                <tr key={op._id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-6 py-4 text-sm text-slate-400">
                    {new Date(op.createdAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-white">{getActionLabel(op.action)}</td>
                  <td className="px-6 py-4 text-sm text-slate-300">{op.entityName || op.entityId}</td>
                  <td className="px-6 py-4 text-sm text-slate-400 max-w-xs truncate">{op.reason}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded text-xs ${
                      op.status === 'executed' ? 'bg-emerald-500/20 text-emerald-400' :
                      op.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
                      op.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                      'bg-slate-500/20 text-slate-400'
                    }`}>
                      {op.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 创建/编辑 Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-3xl border border-white/10 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-white/10">
              <h2 className="text-xl font-semibold text-white">
                {editingAgent ? '编辑 Agent' : '创建 Agent'}
              </h2>
            </div>

            <div className="p-6 space-y-6">
              {/* 基本信息 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-2">名称</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white"
                    placeholder="我的投放 Agent"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-2">状态</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white"
                  >
                    <option value="paused">暂停</option>
                    <option value="active">运行</option>
                    <option value="disabled">禁用</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-2">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white h-20"
                  placeholder="描述这个 Agent 的用途..."
                />
              </div>

              {/* 运行模式 */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">运行模式</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'observe', label: '观察', desc: '仅分析，不操作' },
                    { value: 'suggest', label: '建议', desc: '分析并推送建议' },
                    { value: 'auto', label: '自动', desc: '自动执行优化' },
                  ].map(mode => (
                    <button
                      key={mode.value}
                      onClick={() => setFormData({ ...formData, mode: mode.value })}
                      className={`p-3 rounded-xl border text-left ${
                        formData.mode === mode.value
                          ? 'bg-blue-500/20 border-blue-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
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
                <label className="block text-sm text-slate-400 mb-2">目标设置</label>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">目标 ROAS</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.objectives.targetRoas}
                      onChange={(e) => setFormData({
                        ...formData,
                        objectives: { ...formData.objectives, targetRoas: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">最高 CPA</label>
                    <input
                      type="number"
                      value={formData.objectives.maxCpa}
                      onChange={(e) => setFormData({
                        ...formData,
                        objectives: { ...formData.objectives, maxCpa: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                      placeholder="$"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">日预算上限</label>
                    <input
                      type="number"
                      value={formData.objectives.dailyBudgetLimit}
                      onChange={(e) => setFormData({
                        ...formData,
                        objectives: { ...formData.objectives, dailyBudgetLimit: parseFloat(e.target.value) || 0 }
                      })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white"
                      placeholder="$"
                    />
                  </div>
                </div>
              </div>

              {/* 自动化规则 */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">自动化规则</label>
                <div className="space-y-3">
                  {/* 自动关停 */}
                  <div className="bg-white/5 rounded-xl p-4">
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="text-white">自动关停</div>
                        <div className="text-xs text-slate-500">ROAS 过低时自动暂停广告</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.rules.autoStop.enabled}
                        onChange={(e) => setFormData({
                          ...formData,
                          rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, enabled: e.target.checked } }
                        })}
                        className="w-5 h-5 rounded"
                      />
                    </label>
                    {formData.rules.autoStop.enabled && (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <label className="text-xs text-slate-500">ROAS 阈值</label>
                          <input
                            type="number"
                            step="0.1"
                            value={formData.rules.autoStop.roasThreshold}
                            onChange={(e) => setFormData({
                              ...formData,
                              rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, roasThreshold: parseFloat(e.target.value) } }
                            })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">连续天数</label>
                          <input
                            type="number"
                            value={formData.rules.autoStop.minDays}
                            onChange={(e) => setFormData({
                              ...formData,
                              rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, minDays: parseInt(e.target.value) } }
                            })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">最小消耗 $</label>
                          <input
                            type="number"
                            value={formData.rules.autoStop.minSpend}
                            onChange={(e) => setFormData({
                              ...formData,
                              rules: { ...formData.rules, autoStop: { ...formData.rules.autoStop, minSpend: parseFloat(e.target.value) } }
                            })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 自动扩量 */}
                  <div className="bg-white/5 rounded-xl p-4">
                    <label className="flex items-center justify-between">
                      <div>
                        <div className="text-white">自动扩量</div>
                        <div className="text-xs text-slate-500">ROAS 优秀时自动提升预算</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={formData.rules.autoScale.enabled}
                        onChange={(e) => setFormData({
                          ...formData,
                          rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, enabled: e.target.checked } }
                        })}
                        className="w-5 h-5 rounded"
                      />
                    </label>
                    {formData.rules.autoScale.enabled && (
                      <div className="grid grid-cols-3 gap-2 mt-3">
                        <div>
                          <label className="text-xs text-slate-500">ROAS 阈值</label>
                          <input
                            type="number"
                            step="0.1"
                            value={formData.rules.autoScale.roasThreshold}
                            onChange={(e) => setFormData({
                              ...formData,
                              rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, roasThreshold: parseFloat(e.target.value) } }
                            })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">连续天数</label>
                          <input
                            type="number"
                            value={formData.rules.autoScale.minDays}
                            onChange={(e) => setFormData({
                              ...formData,
                              rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, minDays: parseInt(e.target.value) } }
                            })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500">提升比例 %</label>
                          <input
                            type="number"
                            value={formData.rules.autoScale.budgetIncrease * 100}
                            onChange={(e) => setFormData({
                              ...formData,
                              rules: { ...formData.rules, autoScale: { ...formData.rules.autoScale, budgetIncrease: parseFloat(e.target.value) / 100 } }
                            })}
                            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-white text-sm"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-white/10 flex justify-end gap-3">
              <button
                onClick={() => { setShowModal(false); resetForm(); }}
                className="px-6 py-2 bg-white/5 text-slate-300 rounded-xl hover:bg-white/10 transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveAgent}
                disabled={loading || !formData.name}
                className="px-6 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
