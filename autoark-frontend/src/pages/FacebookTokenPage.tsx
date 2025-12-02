import { useState, useEffect } from 'react'
import {
  bindToken,
  getTokens,
  checkTokenStatus,
  updateToken,
  deleteToken,
  type FbToken,
} from '../services/api'

export default function FacebookTokenPage() {
  const [token, setToken] = useState('')
  const [optimizer, setOptimizer] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 列表相关
  const [tokens, setTokens] = useState<FbToken[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // 筛选相关
  const [filterOptimizer, setFilterOptimizer] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterStartDate, setFilterStartDate] = useState('')
  const [filterEndDate, setFilterEndDate] = useState('')

  // 编辑相关
  const [editingToken, setEditingToken] = useState<FbToken | null>(null)
  const [editOptimizer, setEditOptimizer] = useState('')

  // 加载 token 列表
  const loadTokens = async () => {
    setLoadingList(true)
    try {
      const params: any = {}
      if (filterOptimizer) params.optimizer = filterOptimizer
      if (filterStatus) params.status = filterStatus
      if (filterStartDate) params.startDate = filterStartDate
      if (filterEndDate) params.endDate = filterEndDate

      const response = await getTokens(params)
      setTokens(response.data)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载失败' })
    } finally {
      setLoadingList(false)
    }
  }

  // 初始加载
  useEffect(() => {
    loadTokens()
  }, [])

  // 绑定 token
  const handleBindToken = async () => {
    if (!token.trim()) {
      setMessage({ type: 'error', text: '请输入 token' })
      return
    }

    setLoading(true)
    setMessage(null)

    try {
      await bindToken({
        token: token.trim(),
        optimizer: optimizer.trim() || undefined,
      })
      setMessage({ type: 'success', text: 'Token 绑定成功！' })
      setToken('')
      setOptimizer('')
      await loadTokens() // 重新加载列表
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '绑定失败' })
    } finally {
      setLoading(false)
    }
  }

  // 检查 token 状态
  const handleCheckStatus = async (id: string) => {
    try {
      await checkTokenStatus(id)
      setMessage({ type: 'success', text: '状态检查完成' })
      await loadTokens()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '检查失败' })
    }
  }

  // 开始编辑
  const handleStartEdit = (token: FbToken) => {
    setEditingToken(token)
    setEditOptimizer(token.optimizer || '')
  }

  // 保存编辑
  const handleSaveEdit = async () => {
    if (!editingToken) return

    try {
      await updateToken(editingToken.id, {
        optimizer: editOptimizer.trim() || undefined,
      })
      setMessage({ type: 'success', text: '更新成功' })
      setEditingToken(null)
      await loadTokens()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '更新失败' })
    }
  }

  // 删除 token
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个 token 吗？')) return

    try {
      await deleteToken(id)
      setMessage({ type: 'success', text: '删除成功' })
      await loadTokens()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '删除失败' })
    }
  }

  // 应用筛选
  const handleApplyFilter = () => {
    loadTokens()
  }

  // 清除筛选
  const handleClearFilter = () => {
    setFilterOptimizer('')
    setFilterStatus('')
    setFilterStartDate('')
    setFilterEndDate('')
    setTimeout(loadTokens, 100)
  }

  // 状态颜色
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-400 border-green-500/30'
      case 'expired':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
      case 'invalid':
        return 'bg-red-500/20 text-red-400 border-red-500/30'
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30'
    }
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 标题 */}
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Facebook Token 管理</h1>
          <button
            onClick={loadTokens}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors"
          >
            刷新列表
          </button>
        </header>

        {/* 消息提示 */}
        {message && (
          <div
            className={`p-4 rounded-lg border ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {message.text}
            <button
              onClick={() => setMessage(null)}
              className="float-right text-sm opacity-70 hover:opacity-100"
            >
              ×
            </button>
          </div>
        )}

        {/* 绑定 Token 表单 */}
        <section className="bg-slate-900/70 rounded-xl border border-slate-800 p-6">
          <h2 className="text-xl font-semibold mb-4">绑定新 Token</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                Facebook Access Token
              </label>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="粘贴你的 Facebook Access Token"
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">
                优化师（可选）
              </label>
              <input
                type="text"
                value={optimizer}
                onChange={(e) => setOptimizer(e.target.value)}
                placeholder="输入优化师名称"
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleBindToken}
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
            >
              {loading ? '绑定中...' : '绑定 Token'}
            </button>
          </div>
        </section>

        {/* 筛选器 */}
        <section className="bg-slate-900/70 rounded-xl border border-slate-800 p-6">
          <h2 className="text-xl font-semibold mb-4">筛选条件</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-slate-300 mb-2">优化师</label>
              <input
                type="text"
                value={filterOptimizer}
                onChange={(e) => setFilterOptimizer(e.target.value)}
                placeholder="输入优化师名称"
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">状态</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">全部</option>
                <option value="active">有效</option>
                <option value="expired">已过期</option>
                <option value="invalid">无效</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">开始日期</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-2">结束日期</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleApplyFilter}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
            >
              应用筛选
            </button>
            <button
              onClick={handleClearFilter}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm font-medium transition-colors"
            >
              清除筛选
            </button>
          </div>
        </section>

        {/* Token 列表 */}
        <section className="bg-slate-900/70 rounded-xl border border-slate-800 p-6">
          <h2 className="text-xl font-semibold mb-4">
            Token 列表 ({tokens.length})
          </h2>
          {loadingList ? (
            <div className="text-center py-8 text-slate-400">加载中...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-8 text-slate-400">暂无数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/50 text-slate-300">
                  <tr>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      Facebook 用户
                    </th>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      优化师
                    </th>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      状态
                    </th>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      过期时间
                    </th>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      最后检查
                    </th>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      创建时间
                    </th>
                    <th className="px-4 py-3 text-left border-b border-slate-700">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {tokens.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium">{item.fbUserName || '-'}</div>
                          <div className="text-xs text-slate-400">
                            {item.fbUserId || '-'}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {editingToken?.id === item.id ? (
                          <input
                            type="text"
                            value={editOptimizer}
                            onChange={(e) => setEditOptimizer(e.target.value)}
                            className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-slate-100 text-xs w-24"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit()
                              if (e.key === 'Escape') setEditingToken(null)
                            }}
                            autoFocus
                          />
                        ) : (
                          <span>{item.optimizer || '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded text-xs border ${getStatusColor(
                            item.status,
                          )}`}
                        >
                          {item.status === 'active'
                            ? '有效'
                            : item.status === 'expired'
                              ? '已过期'
                              : '无效'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDate(item.expiresAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDate(item.lastCheckedAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatDate(item.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {editingToken?.id === item.id ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                                className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs transition-colors"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingToken(null)}
                                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleCheckStatus(item.id)}
                                className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs transition-colors"
                                title="检查状态"
                              >
                                检查
                              </button>
                              <button
                                onClick={() => handleStartEdit(item)}
                                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs transition-colors"
                                title="编辑优化师"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
                                title="删除"
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
