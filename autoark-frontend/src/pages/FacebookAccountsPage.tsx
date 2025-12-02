import { useState, useEffect } from 'react'
import { getAccounts, syncAccounts, type FbAccount } from '../services/api'

export default function FacebookAccountsPage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> } | null>(null)

  // 列表数据
  const [accounts, setAccounts] = useState<FbAccount[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1
  })
  
  // 排序状态
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)

  // 筛选条件
  const [filters, setFilters] = useState({
    optimizer: '',
    status: '',
    accountId: '',
    name: '',
    startDate: '',
    endDate: ''
  })

  // 加载列表
  const loadAccounts = async (page = 1) => {
    setLoading(true)
    try {
      const response = await getAccounts({
        page,
        limit: pagination.limit,
        ...filters
      })
      setAccounts(response.data)
      setPagination(response.pagination)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载失败' })
    } finally {
      setLoading(false)
    }
  }

  // 初始加载
  useEffect(() => {
    loadAccounts()
  }, [])

  // 优化：使用防抖，避免筛选时频繁请求
  useEffect(() => {
    // 跳过初始加载（初始加载由上面的 useEffect 处理）
    const hasFilters = filters.optimizer || filters.status || filters.accountId || filters.name || filters.startDate || filters.endDate
    if (!hasFilters) return

    const timeoutId = setTimeout(() => {
      loadAccounts(1) // 筛选时重置到第一页
    }, 500) // 500ms 防抖

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.optimizer, filters.status, filters.accountId, filters.name, filters.startDate, filters.endDate])

  // 执行同步
  const handleSync = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const result = await syncAccounts()
      setMessage({ 
        type: 'success', 
        text: `同步完成！成功: ${result.data.syncedCount}, 失败: ${result.data.errorCount}`,
        errors: result.data.errors || []
      })
      loadAccounts(1) // 刷新列表
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '同步失败' })
    } finally {
      setSyncing(false)
    }
  }

  // iOS 风格状态颜色映射（已直接在 JSX 中使用，此函数保留用于兼容）
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-50/80 border-emerald-200/50 text-emerald-700'
      case 'disabled': return 'bg-red-50/80 border-red-200/50 text-red-700'
      case 'unsettled': return 'bg-amber-50/80 border-amber-200/50 text-amber-700'
      case 'closed': return 'bg-slate-50/80 border-slate-200/50 text-slate-700'
      default: return 'bg-slate-50/80 border-slate-200/50 text-slate-700'
    }
  }

  // 格式化金额
  // Facebook API 返回的 balance 和 amount_spent 都是以账户货币的最小单位（sub-units）返回的
  // 例如：美元账户以"分"为单位，需要除以 100
  const formatCurrency = (amount: number | string | null | undefined, currency: string) => {
    if (amount === null || amount === undefined || amount === '' || amount === 0) return '-'
    
    // 转换为数字
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
    
    // 如果转换失败或为 NaN，返回 '-'
    if (isNaN(numAmount)) return '-'
    
    // Facebook API 返回的是最小单位（分），需要除以 100
    const val = numAmount / 100
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(val)
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 relative overflow-hidden">

      <div className="relative z-10 max-w-7xl mx-auto space-y-6">
        {/* 纯白底头部 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">广告账户管理</h1>
            <span className="bg-slate-100 border border-slate-200 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-700">
              Total: {pagination.total}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`group px-6 py-3 bg-slate-900 hover:bg-slate-800 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95 ${syncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <svg className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? '同步中...' : '同步账户'}
            </button>
          </div>
        </header>

        {/* 纯白底消息提示 */}
        {message && (
          <div className={`p-5 rounded-3xl border shadow-xl animate-fade-in ${
            message.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {message.type === 'success' ? (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  )}
                  <span className="font-medium">{message.text}</span>
                </div>
                {message.errors && message.errors.length > 0 && (
                  <div className="mt-3 pl-8 space-y-2">
                    <div className="text-sm opacity-90">
                      <strong>失败详情：</strong>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {message.errors.slice(0, 5).map((err, idx) => (
                        <div key={idx} className="text-xs opacity-90 pl-3 border-l-2 border-amber-400/50 bg-amber-50/30 rounded-r-lg py-1.5">
                          {err.accountId && <span className="font-mono text-amber-800">账户: {err.accountId}</span>}
                          {err.tokenId && <span className="font-mono text-amber-800">Token: {err.tokenId.substring(0, 8)}...</span>}
                          {err.optimizer && <span className="ml-2 text-amber-800">优化师: {err.optimizer}</span>}
                          <div className="mt-1 text-amber-700">{err.error}</div>
                        </div>
                      ))}
                      {message.errors.length > 5 && (
                        <div className="text-xs opacity-70 italic pl-2">
                          还有 {message.errors.length - 5} 个错误...
                        </div>
                      )}
                    </div>
                    <a
                      href="/dashboard"
                      className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-blue-50 hover:bg-blue-100 rounded-2xl text-sm font-semibold text-blue-700 transition-all active:scale-95 shadow-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      前往日志中心查看完整日志
                    </a>
                  </div>
                )}
              </div>
              <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100 p-2 hover:bg-white/50 rounded-xl transition-all flex-shrink-0 active:scale-95">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* 纯白底筛选区域 */}
        <section className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4 items-end">
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2">开始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={e => setFilters({...filters, startDate: e.target.value})}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2">结束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={e => setFilters({...filters, endDate: e.target.value})}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2">优化师</label>
              <input
                type="text"
                value={filters.optimizer}
                onChange={e => setFilters({...filters, optimizer: e.target.value})}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm placeholder:text-slate-400"
                placeholder="输入名称"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2">账户名称</label>
              <input
                type="text"
                value={filters.name}
                onChange={e => setFilters({...filters, name: e.target.value})}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm placeholder:text-slate-400"
                placeholder="输入账户名称"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2">账户 ID</label>
              <input
                type="text"
                value={filters.accountId}
                onChange={e => setFilters({...filters, accountId: e.target.value})}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm placeholder:text-slate-400"
                placeholder="输入账户ID"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-700 mb-2">状态</label>
              <select
                value={filters.status}
                onChange={e => setFilters({...filters, status: e.target.value})}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm appearance-none cursor-pointer"
              >
                <option value="">全部</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="unsettled">Unsettled</option>
              </select>
            </div>
            <button
              onClick={() => loadAccounts(1)}
              className="w-full px-4 py-3 bg-slate-900 hover:bg-slate-800 rounded-2xl text-sm font-semibold text-white transition-all shadow-md hover:shadow-lg active:scale-95"
            >
              搜索
            </button>
          </div>
        </section>

        {/* 列表区域 */}
        <section className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/5 bg-white/5">
                  <th 
                    className="px-6 py-5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    onClick={() => {
                      const direction = sortConfig?.key === 'name' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      setSortConfig({ key: 'name', direction })
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>账户信息</span>
                      {sortConfig?.key === 'name' && (
                        <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                        </svg>
                      )}
                      {sortConfig?.key !== 'name' && (
                        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    onClick={() => {
                      const direction = sortConfig?.key === 'status' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      setSortConfig({ key: 'status', direction })
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>状态</span>
                      {sortConfig?.key === 'status' && (
                        <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                        </svg>
                      )}
                      {sortConfig?.key !== 'status' && (
                        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    onClick={() => {
                      const direction = sortConfig?.key === 'balance' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      setSortConfig({ key: 'balance', direction })
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>余额 / 花费</span>
                      {sortConfig?.key === 'balance' && (
                        <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                        </svg>
                      )}
                      {sortConfig?.key !== 'balance' && (
                        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    onClick={() => {
                      const direction = sortConfig?.key === 'operator' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      setSortConfig({ key: 'operator', direction })
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>优化师</span>
                      {sortConfig?.key === 'operator' && (
                        <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                        </svg>
                      )}
                      {sortConfig?.key !== 'operator' && (
                        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th className="px-6 py-5 font-semibold text-slate-900 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500 animate-pulse">加载中...</td></tr>
                ) : accounts.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">暂无数据</td></tr>
                ) : (
                  (() => {
                    // 排序逻辑
                    const sortedAccounts = [...accounts]
                    if (sortConfig) {
                      sortedAccounts.sort((a, b) => {
                        let aVal: any, bVal: any
                        if (sortConfig.key === 'balance') {
                          aVal = a.balance ? Number(a.balance) : 0
                          bVal = b.balance ? Number(b.balance) : 0
                        } else if (sortConfig.key === 'name') {
                          aVal = a.name || ''
                          bVal = b.name || ''
                        } else {
                          aVal = (a as any)[sortConfig.key]
                          bVal = (b as any)[sortConfig.key]
                        }
                        if (aVal === null || aVal === undefined) return 1
                        if (bVal === null || bVal === undefined) return -1
                        if (typeof aVal === 'number' && typeof bVal === 'number') {
                          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal
                        }
                        const aStr = String(aVal).toLowerCase()
                        const bStr = String(bVal).toLowerCase()
                        if (sortConfig.direction === 'asc') {
                          return aStr.localeCompare(bStr)
                        } else {
                          return bStr.localeCompare(aStr)
                        }
                      })
                    }
                    return sortedAccounts.map((account) => (
                    <tr key={account.id} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div>
                          <div className="font-medium text-slate-200 group-hover:text-indigo-300 transition-colors">{account.name}</div>
                          <div className="text-xs text-slate-500 font-mono mt-1 opacity-70">ID: {account.accountId}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(account.status)}`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-70`}></span>
                          {account.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-slate-300 text-xs space-y-1">
                          <div>余额: <span className="text-emerald-400 font-mono">{formatCurrency(account.balance, account.currency || 'USD')}</span></div>
                          <div>已用: <span className="text-slate-400 font-mono">{formatCurrency(account.amountSpent, account.currency || 'USD')}</span></div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 border border-white/5">
                            {(account.operator || '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="text-slate-300">{account.operator || '-'}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-slate-400 hover:text-indigo-400 transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                  })()
                )}
              </tbody>
            </table>
          </div>
          
          {/* 纯白底分页 */}
          {pagination.pages > 1 && (
            <div className="px-6 py-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-sm text-slate-700 font-medium">
                显示 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 共 {pagination.total} 条
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => loadAccounts(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                >
                  上一页
                </button>
                <button
                  onClick={() => loadAccounts(pagination.page + 1)}
                  disabled={pagination.page >= pagination.pages}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
