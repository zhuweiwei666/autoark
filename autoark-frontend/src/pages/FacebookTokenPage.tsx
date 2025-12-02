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
    <div className="min-h-screen bg-white text-slate-900 p-6 relative overflow-hidden">

      <div className="relative z-10 max-w-7xl mx-auto space-y-8">
        {/* 标题与操作栏 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Facebook Token 管理</h1>
            <span className="bg-slate-100 border border-slate-200 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-700">
              Total: {tokens.length}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowAddModal(true)}
              className="group px-6 py-3 bg-slate-900 hover:bg-slate-800 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95"
            >
              <svg className="w-5 h-5 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
              </svg>
              添加 Token
            </button>
          <button
            onClick={loadTokens}
              className="px-6 py-3 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 transition-all shadow-sm active:scale-95"
          >
            刷新列表
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
              <span className="font-medium">{message.text}</span>
            </div>
            <button
              onClick={() => setMessage(null)}
              className="opacity-60 hover:opacity-100 p-2 hover:bg-white/50 rounded-xl transition-all active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* 筛选器 */}
        <section className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center justify-between mb-6">
             <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
               <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
               筛选条件
             </h2>
             {(filterOptimizer || filterStatus || filterStartDate || filterEndDate) && (
            <button
                    onClick={handleClearFilter}
                    className="text-sm text-slate-700 hover:text-slate-900 font-semibold px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl transition-all active:scale-95 shadow-sm"
            >
                    重置筛选
            </button>
             )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 items-end">
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2 group-focus-within:text-slate-900 transition-colors">优化师</label>
              <input
                type="text"
                value={filterOptimizer}
                onChange={(e) => setFilterOptimizer(e.target.value)}
                placeholder="输入名称"
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2 group-focus-within:text-slate-900 transition-colors">状态</label>
              <div className="relative">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all appearance-none cursor-pointer shadow-sm"
              >
                  <option value="">全部状态</option>
                <option value="active">有效</option>
                <option value="expired">已过期</option>
                <option value="invalid">无效</option>
              </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2 group-focus-within:text-slate-900 transition-colors">开始日期</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2 group-focus-within:text-slate-900 transition-colors">结束日期</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
              />
            </div>
            <div>
            <button
              onClick={handleApplyFilter}
                 className="w-full px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-sm font-semibold transition-all shadow-md hover:shadow-lg active:scale-95"
            >
                 执行筛选
            </button>
            </div>
          </div>
        </section>

        {/* Token 列表 */}
        <section className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-black/5 border border-slate-200">
            <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-5 font-semibold text-slate-900">Facebook 用户</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">优化师</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">状态</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">过期时间</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">最后检查</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">创建时间</th>
                  <th className="px-6 py-5 font-semibold text-slate-900 text-right">操作</th>
                  </tr>
                </thead>
              <tbody>
                {loadingList ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500 animate-pulse">加载数据中...</td></tr>
                ) : tokens.length === 0 ? (
                    <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500">暂无符合条件的 Token</td></tr>
                ) : (
                    tokens.map((item) => (
                  <tr key={item.id} className="group hover:bg-slate-50 transition-colors border-b border-slate-100">
                    <td className="px-6 py-4">
                        <div>
                        <div className="font-semibold text-slate-900 group-hover:text-slate-950 transition-colors">{item.fbUserName || '-'}</div>
                        <div className="text-xs text-slate-500 font-mono mt-1">
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
                                className="px-3 py-1.5 bg-white border border-slate-400 rounded-lg text-slate-900 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-slate-400"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit()
                              if (e.key === 'Escape') setEditingToken(null)
                            }}
                            autoFocus
                          />
                        </div>
                        ) : (
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300 flex items-center justify-center text-xs font-bold text-slate-700">
                                {(item.optimizer || '?').charAt(0).toUpperCase()}
                            </div>
                            <span className="text-slate-900 font-medium">{item.optimizer || '-'}</span>
                        </div>
                        )}
                      </td>
                    <td className="px-6 py-4">
                        <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${
                          item.status === 'active'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : item.status === 'expired'
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-red-50 border-red-200 text-red-700'
                        }`}
                        >
                        <span className={`w-1.5 h-1.5 rounded-full mr-2 ${
                            item.status === 'active' ? 'bg-emerald-500' : 
                            item.status === 'expired' ? 'bg-amber-500' : 'bg-red-500'
                        }`}></span>
                          {item.status === 'active'
                            ? '有效'
                            : item.status === 'expired'
                              ? '已过期'
                              : '无效'}
                        </span>
                      </td>
                    <td className="px-6 py-4 text-slate-700 whitespace-nowrap text-xs">
                        {formatDate(item.expiresAt)}
                      </td>
                    <td className="px-6 py-4 text-slate-700 whitespace-nowrap text-xs">
                        {formatDate(item.lastCheckedAt)}
                      </td>
                    <td className="px-6 py-4 text-slate-700 whitespace-nowrap text-xs font-mono">
                        {formatDate(item.createdAt)}
                      </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                          {editingToken?.id === item.id ? (
                            <>
                              <button
                                onClick={handleSaveEdit}
                              className="p-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                              title="保存"
                              >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                              </button>
                              <button
                                onClick={() => setEditingToken(null)}
                              className="p-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
                              title="取消"
                              >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleCheckStatus(item.id)}
                              className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                title="检查状态"
                              >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              </button>
                              <button
                                onClick={() => handleStartEdit(item)}
                              className="p-2 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                title="编辑优化师"
                              >
                               <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                              className="p-2 text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
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
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
            {/* 点击遮罩关闭 */}
          <div 
             className="absolute inset-0" 
             onClick={() => !loading && setShowAddModal(false)}
          ></div>
          
          <div className="bg-white border border-slate-300 rounded-3xl p-8 w-full max-w-lg shadow-2xl relative z-10 transform transition-all scale-100">
            <h2 className="text-2xl font-bold text-slate-900 mb-8 flex items-center gap-3">
                <div className="bg-slate-100 border border-slate-200 p-2.5 rounded-2xl text-slate-700">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                </div>
                绑定新 Token
            </h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Facebook Access Token <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                    <textarea
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="EAA..."
                    className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all font-mono text-sm resize-none shadow-sm"
                    rows={4}
                    />
                    <div className="absolute bottom-3 right-3 text-xs text-slate-500 font-mono">
                        {token.length} chars
                    </div>
                </div>
                <p className="mt-2 text-xs text-slate-600 flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    请确保输入以 EAA 开头的完整 Access Token
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  优化师名称
                </label>
                <input
                  type="text"
                  value={optimizer}
                  onChange={(e) => setOptimizer(e.target.value)}
                  placeholder="例如: John Doe"
                  className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
                />
              </div>

              <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-slate-200">
                <button
                  onClick={() => setShowAddModal(false)}
                  disabled={loading}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-slate-700 font-semibold transition-colors disabled:opacity-50 shadow-sm active:scale-95"
                >
                  取消
                </button>
                <button
                  onClick={handleBindToken}
                  disabled={loading}
                  className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 rounded-2xl text-white font-semibold transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
                >
                  {loading ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        验证中...
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
