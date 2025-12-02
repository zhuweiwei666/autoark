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
  const [showAddModal, setShowAddModal] = useState(false)
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
      setShowAddModal(false) // 关闭弹窗
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
        {/* 标题与操作栏 */}
        <header className="flex items-center justify-between bg-slate-900/50 p-4 rounded-xl border border-slate-800 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-white">Facebook Token 管理</h1>
            <div className="flex items-center gap-2 text-sm text-slate-400">
                <span className="bg-slate-800 px-2 py-1 rounded">总数: {tokens.length}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 text-white"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              添加 Token
            </button>
            <button
              onClick={loadTokens}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors text-slate-300"
            >
              刷新
            </button>
          </div>
        </header>

        {/* 消息提示 */}
        {message && (
          <div
            className={`p-4 rounded-lg border flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="text-sm opacity-70 hover:opacity-100 hover:bg-black/10 p-1 rounded"
            >
              关闭
            </button>
          </div>
        )}

        {/* 筛选器 */}
        <section className="bg-slate-900/70 rounded-xl border border-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-lg font-semibold text-slate-200">筛选条件</h2>
             {(filterOptimizer || filterStatus || filterStartDate || filterEndDate) && (
                 <button 
                    onClick={handleClearFilter}
                    className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                 >
                    清除所有筛选
                 </button>
             )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">优化师</label>
              <input
                type="text"
                value={filterOptimizer}
                onChange={(e) => setFilterOptimizer(e.target.value)}
                placeholder="输入名称"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">状态</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">全部状态</option>
                <option value="active">有效</option>
                <option value="expired">已过期</option>
                <option value="invalid">无效</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">开始日期</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">结束日期</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
               <button
                 onClick={handleApplyFilter}
                 className="w-full px-4 py-2 bg-blue-600/90 hover:bg-blue-600 rounded-lg text-sm font-medium transition-colors text-white"
               >
                 应用筛选
               </button>
            </div>
          </div>
        </section>

        {/* Token 列表 */}
        <section className="bg-slate-900/70 rounded-xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-800/80 text-slate-400 uppercase text-xs font-medium">
                <tr>
                  <th className="px-6 py-4">Facebook 用户</th>
                  <th className="px-6 py-4">优化师</th>
                  <th className="px-6 py-4">状态</th>
                  <th className="px-6 py-4">过期时间</th>
                  <th className="px-6 py-4">最后检查</th>
                  <th className="px-6 py-4">创建时间</th>
                  <th className="px-6 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {loadingList ? (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">加载数据中...</td></tr>
                ) : tokens.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-8 text-center text-slate-500">暂无符合条件的 Token</td></tr>
                ) : (
                    tokens.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <div className="font-medium text-slate-200">{item.fbUserName || '-'}</div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {item.fbUserId || '-'}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {editingToken?.id === item.id ? (
                        <div className="flex items-center gap-2">
                             <input
                                type="text"
                                value={editOptimizer}
                                onChange={(e) => setEditOptimizer(e.target.value)}
                                className="px-2 py-1 bg-slate-950 border border-slate-700 rounded text-slate-100 text-xs w-28 focus:outline-none focus:border-blue-500"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEdit()
                                    if (e.key === 'Escape') setEditingToken(null)
                                }}
                                autoFocus
                             />
                        </div>
                      ) : (
                        <span className="text-slate-300">{item.optimizer || '-'}</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(
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
                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                      {formatDate(item.expiresAt)}
                    </td>
                    <td className="px-6 py-4 text-slate-400 whitespace-nowrap">
                      {formatDate(item.lastCheckedAt)}
                    </td>
                    <td className="px-6 py-4 text-slate-500 whitespace-nowrap text-xs">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {editingToken?.id === item.id ? (
                          <>
                            <button
                              onClick={handleSaveEdit}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs text-white transition-colors"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingToken(null)}
                              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-200 transition-colors"
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleCheckStatus(item.id)}
                              className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                              title="检查状态"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            </button>
                            <button
                              onClick={() => handleStartEdit(item)}
                              className="p-1.5 text-slate-400 hover:text-slate-300 hover:bg-slate-700/30 rounded transition-colors"
                              title="编辑优化师"
                            >
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                              title="删除"
                            >
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* 添加 Token 弹窗 */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
            {/* 点击遮罩关闭 */}
          <div 
             className="absolute inset-0" 
             onClick={() => !loading && setShowAddModal(false)}
          ></div>
          
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative z-10 transform transition-all">
            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <div className="bg-blue-600/20 p-2 rounded-lg text-blue-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                </div>
                绑定新 Token
            </h2>
            
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Facebook Access Token <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="EAA..."
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-mono text-sm resize-none"
                  rows={4}
                />
                <p className="mt-2 text-xs text-slate-500">
                    请确保输入完整的 Access Token，通常以 EAA 开头。
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  优化师名称
                </label>
                <input
                  type="text"
                  value={optimizer}
                  onChange={(e) => setOptimizer(e.target.value)}
                  placeholder="例如: John Doe"
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                />
              </div>

              <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-slate-800">
                <button
                  onClick={() => setShowAddModal(false)}
                  disabled={loading}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-medium transition-colors disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleBindToken}
                  disabled={loading}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-white font-medium transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        验证并绑定...
                      </>
                  ) : (
                      '确认绑定'
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
