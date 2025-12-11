import { useState, useEffect } from 'react'
import Loading from '../components/Loading'
import { useAuth } from '../contexts/AuthContext'

const API_BASE = '/api'

interface FacebookApp {
  _id: string
  appId: string
  appName: string
  appSecretMasked?: string
  status: 'active' | 'inactive' | 'suspended' | 'rate_limited'
  stats?: {
    totalRequests?: number
    successRequests?: number
    failedRequests?: number
    lastUsedAt?: string
    lastErrorAt?: string
    lastError?: string
  }
  config?: {
    maxConcurrentTasks?: number
    requestsPerMinute?: number
    priority?: number
    enabledForBulkAds?: boolean
  }
  currentLoad?: {
    activeTasks?: number
    requestsThisMinute?: number
  }
  validation?: {
    isValid?: boolean
    validatedAt?: string
    validationError?: string
  }
  notes?: string
  createdAt?: string
  updatedAt?: string
  healthScore?: number
  isAvailable?: boolean
}

interface AppStats {
  total: number
  active: number
  inactive: number
  rateLimited: number
  totalRequests: number
  avgHealthScore: number
}

export default function FacebookAppPage() {
  const { token } = useAuth()
  const [apps, setApps] = useState<FacebookApp[]>([])
  const [stats, setStats] = useState<AppStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingApp, setEditingApp] = useState<FacebookApp | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 表单状态
  const [formData, setFormData] = useState({
    appId: '',
    appSecret: '',
    appName: '',
    notes: '',
    maxConcurrentTasks: 5,
    requestsPerMinute: 200,
    priority: 1,
  })

  // 带认证的 fetch
  const authFetch = (url: string, options: RequestInit = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }

  // 加载 Apps 列表
  const loadApps = async () => {
    setLoading(true)
    try {
      const response = await authFetch(`${API_BASE}/facebook-apps`)
      const data = await response.json()
      if (data.success) {
        setApps(data.data)
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载失败' })
    } finally {
      setLoading(false)
    }
  }

  // 加载统计
  const loadStats = async () => {
    try {
      const response = await authFetch(`${API_BASE}/facebook-apps/stats`)
      const data = await response.json()
      if (data.success) {
        setStats(data.data)
      }
    } catch (error) {
      console.error('Load stats failed:', error)
    }
  }

  // 初始加载
  useEffect(() => {
    loadApps()
    loadStats()
  }, [])

  // 创建 App
  const handleCreate = async () => {
    if (!formData.appId.trim() || !formData.appSecret.trim()) {
      setMessage({ type: 'error', text: '请填写 App ID 和 App Secret' })
      return
    }

    setLoading(true)
    try {
      const response = await authFetch(`${API_BASE}/facebook-apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: formData.appId.trim(),
          appSecret: formData.appSecret.trim(),
          appName: formData.appName.trim() || `App ${formData.appId.substring(0, 6)}`,
          notes: formData.notes.trim(),
          config: {
            maxConcurrentTasks: formData.maxConcurrentTasks,
            requestsPerMinute: formData.requestsPerMinute,
            priority: formData.priority,
          },
        }),
      })
      const data = await response.json()
      
      if (data.success) {
        setMessage({ type: 'success', text: 'App 创建成功！' })
        setShowAddModal(false)
        resetForm()
        await loadApps()
        await loadStats()
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '创建失败' })
    } finally {
      setLoading(false)
    }
  }

  // 更新 App
  const handleUpdate = async () => {
    if (!editingApp) return

    setLoading(true)
    try {
      const response = await authFetch(`${API_BASE}/facebook-apps/${editingApp._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appName: formData.appName.trim(),
          appSecret: formData.appSecret.trim() || undefined, // 如果为空则不更新
          notes: formData.notes.trim(),
          config: {
            maxConcurrentTasks: formData.maxConcurrentTasks,
            requestsPerMinute: formData.requestsPerMinute,
            priority: formData.priority,
          },
        }),
      })
      const data = await response.json()
      
      if (data.success) {
        setMessage({ type: 'success', text: 'App 更新成功！' })
        setEditingApp(null)
        resetForm()
        await loadApps()
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '更新失败' })
    } finally {
      setLoading(false)
    }
  }

  // 删除 App
  const handleDelete = async (app: FacebookApp) => {
    if (!confirm(`确定要删除 "${app.appName}" 吗？`)) return

    try {
      const response = await authFetch(`${API_BASE}/facebook-apps/${app._id}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      
      if (data.success) {
        setMessage({ type: 'success', text: '删除成功' })
        await loadApps()
        await loadStats()
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '删除失败' })
    }
  }

  // 验证 App
  const handleValidate = async (app: FacebookApp) => {
    try {
      const response = await authFetch(`${API_BASE}/facebook-apps/${app._id}/validate`, {
        method: 'POST',
      })
      const data = await response.json()
      
      if (data.success) {
        if (data.data.isValid) {
          setMessage({ type: 'success', text: `✅ ${app.appName} 验证成功！` })
        } else {
          setMessage({ type: 'error', text: `❌ ${app.appName} 验证失败: ${data.data.error}` })
        }
        await loadApps()
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '验证失败' })
    }
  }

  // 切换 App 状态
  const handleToggleStatus = async (app: FacebookApp) => {
    const newStatus = app.status === 'active' ? 'inactive' : 'active'
    try {
      const response = await authFetch(`${API_BASE}/facebook-apps/${app._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await response.json()
      
      if (data.success) {
        setMessage({ type: 'success', text: `已${newStatus === 'active' ? '启用' : '禁用'} ${app.appName}` })
        await loadApps()
        await loadStats()
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '操作失败' })
    }
  }

  // 重置统计
  const handleResetStats = async (app: FacebookApp) => {
    if (!confirm(`确定要重置 "${app.appName}" 的统计数据吗？`)) return

    try {
      const response = await authFetch(`${API_BASE}/facebook-apps/${app._id}/reset-stats`, {
        method: 'POST',
      })
      const data = await response.json()
      
      if (data.success) {
        setMessage({ type: 'success', text: '统计已重置' })
        await loadApps()
        await loadStats()
      } else {
        throw new Error(data.error)
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '重置失败' })
    }
  }

  // 开始编辑
  const startEdit = (app: FacebookApp) => {
    setEditingApp(app)
    setFormData({
      appId: app.appId,
      appSecret: '', // 编辑时不显示原 secret
      appName: app.appName,
      notes: app.notes || '',
      maxConcurrentTasks: app.config?.maxConcurrentTasks || 5,
      requestsPerMinute: app.config?.requestsPerMinute || 200,
      priority: app.config?.priority || 1,
    })
  }

  // 重置表单
  const resetForm = () => {
    setFormData({
      appId: '',
      appSecret: '',
      appName: '',
      notes: '',
      maxConcurrentTasks: 5,
      requestsPerMinute: 200,
      priority: 1,
    })
  }

  // 格式化日期
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    try {
      return new Date(dateStr).toLocaleString('zh-CN')
    } catch {
      return dateStr
    }
  }

  // 状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-emerald-50 border-emerald-200 text-emerald-700'
      case 'inactive':
        return 'bg-slate-50 border-slate-200 text-slate-600'
      case 'rate_limited':
        return 'bg-amber-50 border-amber-200 text-amber-700'
      case 'suspended':
        return 'bg-red-50 border-red-200 text-red-700'
      default:
        return 'bg-slate-50 border-slate-200 text-slate-600'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return '运行中'
      case 'inactive': return '已禁用'
      case 'rate_limited': return '限流中'
      case 'suspended': return '已暂停'
      default: return status
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 relative overflow-hidden">
      <div className="relative z-10 max-w-7xl mx-auto space-y-8">
        {/* 标题与操作栏 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center gap-4">
            <div className="bg-blue-100 p-3 rounded-2xl">
              <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Facebook App 管理</h1>
              <p className="text-sm text-slate-500 mt-1">配置多个 Facebook App，支持负载均衡和故障转移</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => { loadApps(); loadStats() }}
              className="group px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              刷新
            </button>
            <button
              onClick={() => {
                resetForm()
                setShowAddModal(true)
              }}
              className="group px-6 py-3 bg-green-600 hover:bg-green-700 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95"
            >
              <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              添加 App
            </button>
          </div>
        </header>

        {/* 消息提示 */}
        {message && (
          <div
            className={`p-5 rounded-3xl border shadow-xl animate-fade-in flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center gap-3">
              {message.type === 'success' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              <span className="font-medium whitespace-pre-line">{message.text}</span>
            </div>
            <button
              onClick={() => setMessage(null)}
              className="opacity-60 hover:opacity-100 p-2 hover:bg-white/50 rounded-xl transition-all active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-white rounded-2xl p-5 shadow-lg shadow-black/5 border border-slate-200">
              <div className="text-sm text-slate-500 mb-1">总计</div>
              <div className="text-3xl font-bold text-slate-900">{stats.total}</div>
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-lg shadow-black/5 border border-emerald-200">
              <div className="text-sm text-emerald-600 mb-1">运行中</div>
              <div className="text-3xl font-bold text-emerald-700">{stats.active}</div>
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-lg shadow-black/5 border border-slate-200">
              <div className="text-sm text-slate-500 mb-1">已禁用</div>
              <div className="text-3xl font-bold text-slate-600">{stats.inactive}</div>
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-lg shadow-black/5 border border-amber-200">
              <div className="text-sm text-amber-600 mb-1">限流中</div>
              <div className="text-3xl font-bold text-amber-700">{stats.rateLimited}</div>
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-lg shadow-black/5 border border-slate-200">
              <div className="text-sm text-slate-500 mb-1">总请求</div>
              <div className="text-3xl font-bold text-slate-900">{stats.totalRequests.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-2xl p-5 shadow-lg shadow-black/5 border border-blue-200">
              <div className="text-sm text-blue-600 mb-1">平均健康度</div>
              <div className="text-3xl font-bold text-blue-700">{stats.avgHealthScore}%</div>
            </div>
          </div>
        )}

        {/* App 卡片列表 */}
        <section>
          {loading && apps.length === 0 ? (
            <Loading.Overlay message="加载 App 列表..." size="md" />
          ) : apps.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-3xl shadow-lg shadow-black/5 border border-slate-200">
              <div className="text-6xl mb-4">🔧</div>
              <h3 className="text-xl font-semibold text-slate-700 mb-2">暂无 Facebook App</h3>
              <p className="text-slate-500 mb-6">添加您的第一个 Facebook App 以开始使用</p>
              <button
                onClick={() => {
                  resetForm()
                  setShowAddModal(true)
                }}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-2xl text-white font-semibold transition-all"
              >
                添加 App
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {apps.map((app) => (
                <div
                  key={app._id}
                  className={`bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border transition-all hover:shadow-xl ${
                    app.status === 'active' ? 'border-emerald-200' : 'border-slate-200'
                  }`}
                >
                  {/* 头部 */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold ${
                        app.status === 'active' 
                          ? 'bg-blue-100 text-blue-600' 
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {app.appName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900">{app.appName}</h3>
                        <p className="text-xs text-slate-500 font-mono">{app.appId}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(app.status)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full mr-2 ${
                        app.status === 'active' ? 'bg-emerald-500 animate-pulse' : 
                        app.status === 'rate_limited' ? 'bg-amber-500' : 
                        app.status === 'suspended' ? 'bg-red-500' : 'bg-slate-400'
                      }`}></span>
                      {getStatusText(app.status)}
                    </span>
                  </div>

                  {/* 统计信息 */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-slate-50 rounded-xl p-3 text-center">
                      <div className="text-xs text-slate-500 mb-1">健康度</div>
                      <div className={`text-lg font-bold ${
                        (app.healthScore || 100) >= 90 ? 'text-emerald-600' :
                        (app.healthScore || 100) >= 70 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {app.healthScore ?? 100}%
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 text-center">
                      <div className="text-xs text-slate-500 mb-1">请求数</div>
                      <div className="text-lg font-bold text-slate-700">
                        {(app.stats?.totalRequests || 0).toLocaleString()}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 text-center">
                      <div className="text-xs text-slate-500 mb-1">当前任务</div>
                      <div className="text-lg font-bold text-slate-700">
                        {app.currentLoad?.activeTasks || 0}
                      </div>
                    </div>
                  </div>

                  {/* 配置信息 */}
                  <div className="text-xs text-slate-500 mb-4 space-y-1">
                    <div className="flex justify-between">
                      <span>最大并发：</span>
                      <span className="font-medium text-slate-700">{app.config?.maxConcurrentTasks || 5}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>优先级：</span>
                      <span className="font-medium text-slate-700">{app.config?.priority || 1}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>验证状态：</span>
                      <span className={`font-medium ${app.validation?.isValid ? 'text-emerald-600' : 'text-red-600'}`}>
                        {app.validation?.isValid ? '✓ 已验证' : '✗ 未验证'}
                      </span>
                    </div>
                    {app.stats?.lastUsedAt && (
                      <div className="flex justify-between">
                        <span>最后使用：</span>
                        <span className="font-medium text-slate-700">{formatDate(app.stats.lastUsedAt)}</span>
                      </div>
                    )}
                  </div>

                  {/* 备注 */}
                  {app.notes && (
                    <div className="text-xs text-slate-500 mb-4 p-3 bg-slate-50 rounded-xl">
                      📝 {app.notes}
                    </div>
                  )}

                  {/* 错误信息 */}
                  {app.stats?.lastError && (
                    <div className="text-xs text-red-600 mb-4 p-3 bg-red-50 rounded-xl border border-red-100">
                      ⚠️ {app.stats.lastError}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleValidate(app)}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-all"
                    >
                      验证
                    </button>
                    <button
                      onClick={() => handleToggleStatus(app)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        app.status === 'active'
                          ? 'bg-amber-50 hover:bg-amber-100 text-amber-700'
                          : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {app.status === 'active' ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => startEdit(app)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-all"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleResetStats(app)}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-all"
                    >
                      重置统计
                    </button>
                    <button
                      onClick={() => handleDelete(app)}
                      className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-medium transition-all"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 使用说明 */}
        <section className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-3xl p-8 border border-blue-100">
          <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            使用说明
          </h2>
          <div className="grid md:grid-cols-2 gap-6 text-sm text-slate-700">
            <div>
              <h3 className="font-semibold mb-2">🔧 如何获取 App ID 和 Secret</h3>
              <ol className="list-decimal list-inside space-y-1 text-slate-600">
                <li>访问 <a href="https://developers.facebook.com" target="_blank" rel="noopener" className="text-blue-600 hover:underline">Facebook Developer Portal</a></li>
                <li>创建或选择一个应用</li>
                <li>在"设置" → "基本"中找到 App ID</li>
                <li>点击"显示"查看 App Secret</li>
              </ol>
            </div>
            <div>
              <h3 className="font-semibold mb-2">⚡ 多 App 负载均衡</h3>
              <ul className="list-disc list-inside space-y-1 text-slate-600">
                <li>系统自动选择负载最低的 App 执行任务</li>
                <li>支持优先级设置，数字越大优先级越高</li>
                <li>自动检测限流并临时切换到其他 App</li>
                <li>单个 App 故障不影响整体服务</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      {/* 添加/编辑弹窗 */}
      {(showAddModal || editingApp) && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div 
            className="absolute inset-0" 
            onClick={() => { setShowAddModal(false); setEditingApp(null); resetForm() }}
          ></div>
          
          <div className="bg-white border border-slate-300 rounded-3xl p-8 w-full max-w-lg shadow-2xl relative z-10">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
              <div className="bg-blue-100 p-2.5 rounded-2xl text-blue-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              {editingApp ? '编辑 App' : '添加 Facebook App'}
            </h2>
            
            <div className="space-y-5">
              {!editingApp && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    App ID <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.appId}
                    onChange={(e) => setFormData({ ...formData, appId: e.target.value })}
                    placeholder="123456789012345"
                    className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all font-mono"
                  />
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  App Secret {!editingApp && <span className="text-red-600">*</span>}
                  {editingApp && <span className="text-slate-400 text-xs ml-2">(留空则不修改)</span>}
                </label>
                <input
                  type="password"
                  value={formData.appSecret}
                  onChange={(e) => setFormData({ ...formData, appSecret: e.target.value })}
                  placeholder={editingApp ? '••••••••' : 'abc123def456...'}
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all font-mono"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  App 名称
                </label>
                <input
                  type="text"
                  value={formData.appName}
                  onChange={(e) => setFormData({ ...formData, appName: e.target.value })}
                  placeholder="例如: 主号 App"
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    最大并发
                  </label>
                  <input
                    type="number"
                    value={formData.maxConcurrentTasks}
                    onChange={(e) => setFormData({ ...formData, maxConcurrentTasks: Number(e.target.value) })}
                    min={1}
                    max={20}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    每分钟限制
                  </label>
                  <input
                    type="number"
                    value={formData.requestsPerMinute}
                    onChange={(e) => setFormData({ ...formData, requestsPerMinute: Number(e.target.value) })}
                    min={10}
                    max={1000}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-2">
                    优先级
                  </label>
                  <input
                    type="number"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: Number(e.target.value) })}
                    min={1}
                    max={10}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-slate-900 text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  备注
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="可选：添加一些备注信息"
                  rows={2}
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-slate-200">
                <button
                  onClick={() => { setShowAddModal(false); setEditingApp(null); resetForm() }}
                  disabled={loading}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-slate-700 font-semibold transition-colors disabled:opacity-50 shadow-sm active:scale-95"
                >
                  取消
                </button>
                <button
                  onClick={editingApp ? handleUpdate : handleCreate}
                  disabled={loading}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-2xl text-white font-semibold transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
                >
                  {loading ? (
                    <>
                      <Loading.Spinner size="sm" color="white" />
                      处理中...
                    </>
                  ) : (
                    editingApp ? '保存修改' : '添加 App'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

