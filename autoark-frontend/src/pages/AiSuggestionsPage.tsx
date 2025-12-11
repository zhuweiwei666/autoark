import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { authFetch } from '../services/api'

interface Suggestion {
  _id: string
  type: string
  priority: 'high' | 'medium' | 'low'
  entityType: string
  entityId: string
  entityName: string
  accountId: string
  title: string
  description: string
  reason: string
  currentMetrics: {
    roas?: number
    spend?: number
    ctr?: number
  }
  action: {
    type: string
    params?: any
  }
  expectedImpact?: string
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired'
  execution?: {
    executedAt?: string
    success?: boolean
    error?: string
  }
  createdAt: string
}

interface Stats {
  pending: number
  executed: number
  failed: number
  rejected: number
  byPriority: { high: number; medium: number; low: number }
}

export default function AiSuggestionsPage() {
  const { token } = useAuth()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [executing, setExecuting] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [filter, setFilter] = useState<'pending' | 'executed' | 'all'>('pending')
  const [generating, setGenerating] = useState(false)

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  })

  useEffect(() => {
    if (token) {
      loadData()
    }
  }, [token, filter])

  const loadData = async () => {
    setLoading(true)
    try {
      const [suggestionsRes, statsRes] = await Promise.all([
        fetch(`/api/ai-suggestions${filter === 'pending' ? '/pending' : `?status=${filter === 'all' ? '' : filter}`}`, {
          headers: getAuthHeaders()
        }),
        fetch('/api/ai-suggestions/stats', { headers: getAuthHeaders() }),
      ])
      
      const suggestionsData = await suggestionsRes.json()
      const statsData = await statsRes.json()
      
      if (suggestionsData.success) {
        setSuggestions(filter === 'pending' ? suggestionsData.data : suggestionsData.data.suggestions)
      }
      if (statsData.success) {
        setStats(statsData.data)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    }
    setLoading(false)
  }

  const generateSuggestions = async () => {
    setGenerating(true)
    try {
      const res = await authFetch('/api/ai-suggestions/generate', {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        alert(`生成了 ${data.data.length} 条新建议`)
        loadData()
      }
    } catch (error) {
      console.error('Failed to generate:', error)
    }
    setGenerating(false)
  }

  const executeSuggestion = async (id: string) => {
    setExecuting(id)
    try {
      const res = await authFetch(`/api/ai-suggestions/${id}/execute`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        loadData()
      } else {
        alert(`执行失败: ${data.error}`)
      }
    } catch (error) {
      console.error('Failed to execute:', error)
    }
    setExecuting(null)
  }

  const rejectSuggestion = async (id: string) => {
    try {
      const res = await authFetch(`/api/ai-suggestions/${id}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      const data = await res.json()
      if (data.success) {
        loadData()
      }
    } catch (error) {
      console.error('Failed to reject:', error)
    }
  }

  const executeBatch = async () => {
    if (selectedIds.length === 0) {
      alert('请先选择要执行的建议')
      return
    }
    
    if (!confirm(`确定执行选中的 ${selectedIds.length} 条建议吗？`)) return
    
    setExecuting('batch')
    try {
      const res = await authFetch('/api/ai-suggestions/execute-batch', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: selectedIds }),
      })
      const data = await res.json()
      if (data.success) {
        alert(`执行完成：成功 ${data.data.success} 条，失败 ${data.data.failed} 条`)
        setSelectedIds([])
        loadData()
      }
    } catch (error) {
      console.error('Failed to execute batch:', error)
    }
    setExecuting(null)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const selectAll = () => {
    const pendingIds = suggestions.filter(s => s.status === 'pending').map(s => s._id)
    setSelectedIds(prev => prev.length === pendingIds.length ? [] : pendingIds)
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">🔴 高优先</span>
      case 'medium':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700">🟡 中等</span>
      case 'low':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-600">⚪ 低优先</span>
      default:
        return null
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">待处理</span>
      case 'executed':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">✓ 已执行</span>
      case 'failed':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">✗ 失败</span>
      case 'rejected':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-600">已忽略</span>
      case 'expired':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-400">已过期</span>
      default:
        return null
    }
  }

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'pause_campaign':
      case 'pause_adset':
      case 'pause_ad':
        return '⏸️'
      case 'enable_ad':
        return '▶️'
      case 'budget_increase':
        return '📈'
      case 'budget_decrease':
        return '📉'
      case 'alert':
        return '🔔'
      default:
        return '⚙️'
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
          <h1 className="text-2xl font-bold text-slate-800">🤖 AI 优化建议</h1>
          <p className="text-slate-500 mt-1">AI 分析生成的优化建议，可一键执行</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={generateSuggestions}
            disabled={generating}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? '生成中...' : '🔄 生成建议'}
          </button>
          {selectedIds.length > 0 && (
            <button
              onClick={executeBatch}
              disabled={executing === 'batch'}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {executing === 'batch' ? '执行中...' : `✓ 执行选中 (${selectedIds.length})`}
            </button>
          )}
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.pending}</div>
            <div className="text-sm text-slate-500">待处理</div>
            <div className="text-xs text-slate-400 mt-1">
              🔴 {stats.byPriority.high} 🟡 {stats.byPriority.medium} ⚪ {stats.byPriority.low}
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-2xl font-bold text-emerald-600">{stats.executed}</div>
            <div className="text-sm text-slate-500">已执行</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
            <div className="text-sm text-slate-500">执行失败</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-2xl font-bold text-slate-400">{stats.rejected}</div>
            <div className="text-sm text-slate-500">已忽略</div>
          </div>
        </div>
      )}

      {/* 筛选 */}
      <div className="flex gap-2 mb-4">
        {['pending', 'executed', 'all'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f as any)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f 
                ? 'bg-indigo-600 text-white' 
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f === 'pending' ? '待处理' : f === 'executed' ? '已执行' : '全部'}
          </button>
        ))}
        
        {filter === 'pending' && suggestions.length > 0 && (
          <button
            onClick={selectAll}
            className="ml-auto px-4 py-2 text-sm text-indigo-600 hover:bg-indigo-50 rounded-lg"
          >
            {selectedIds.length === suggestions.filter(s => s.status === 'pending').length ? '取消全选' : '全选'}
          </button>
        )}
      </div>

      {/* 建议列表 */}
      <div className="space-y-4">
        {suggestions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <div className="text-4xl mb-4">🤖</div>
            <h3 className="text-lg font-medium text-slate-800 mb-2">暂无建议</h3>
            <p className="text-slate-500 mb-4">点击"生成建议"让 AI 分析数据</p>
            <button
              onClick={generateSuggestions}
              disabled={generating}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              🔄 生成建议
            </button>
          </div>
        ) : (
          suggestions.map(suggestion => (
            <div
              key={suggestion._id}
              className={`bg-white rounded-xl shadow-sm p-5 transition-all ${
                selectedIds.includes(suggestion._id) ? 'ring-2 ring-indigo-500' : ''
              }`}
            >
              <div className="flex items-start gap-4">
                {/* 选择框 */}
                {suggestion.status === 'pending' && (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(suggestion._id)}
                    onChange={() => toggleSelect(suggestion._id)}
                    className="mt-1 w-5 h-5 text-indigo-600 rounded"
                  />
                )}
                
                {/* 图标 */}
                <div className="text-2xl">{getActionIcon(suggestion.type)}</div>
                
                {/* 内容 */}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-slate-800">{suggestion.title}</h3>
                    {getPriorityBadge(suggestion.priority)}
                    {getStatusBadge(suggestion.status)}
                  </div>
                  
                  <p className="text-sm text-slate-600 mb-2">{suggestion.description}</p>
                  
                  {suggestion.reason && (
                    <p className="text-xs text-slate-500 mb-2">💡 {suggestion.reason}</p>
                  )}
                  
                  {suggestion.currentMetrics && (
                    <div className="flex gap-4 text-xs text-slate-500 mb-2">
                      {suggestion.currentMetrics.roas !== undefined && (
                        <span>ROAS: {suggestion.currentMetrics.roas.toFixed(2)}</span>
                      )}
                      {suggestion.currentMetrics.spend !== undefined && (
                        <span>消耗: ${suggestion.currentMetrics.spend.toFixed(2)}</span>
                      )}
                    </div>
                  )}
                  
                  {suggestion.expectedImpact && (
                    <p className="text-xs text-emerald-600">📊 {suggestion.expectedImpact}</p>
                  )}
                  
                  {suggestion.execution?.error && (
                    <p className="text-xs text-red-500 mt-2">❌ {suggestion.execution.error}</p>
                  )}
                </div>
                
                {/* 操作按钮 */}
                {suggestion.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => executeSuggestion(suggestion._id)}
                      disabled={executing === suggestion._id}
                      className="px-3 py-1.5 text-sm bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 disabled:opacity-50"
                    >
                      {executing === suggestion._id ? '执行中...' : '✓ 执行'}
                    </button>
                    <button
                      onClick={() => rejectSuggestion(suggestion._id)}
                      className="px-3 py-1.5 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                    >
                      忽略
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
