import { useState, useEffect } from 'react'
import { getAccounts, syncAccounts, type FbAccount } from '../services/api'

export default function FacebookAccountsPage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 列表数据
  const [accounts, setAccounts] = useState<FbAccount[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1
  })

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

  // 执行同步
  const handleSync = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const result = await syncAccounts()
      setMessage({ 
        type: 'success', 
        text: `同步完成！成功: ${result.data.syncedCount}, 失败: ${result.data.errorCount}` 
      })
      loadAccounts(1) // 刷新列表
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '同步失败' })
    } finally {
      setSyncing(false)
    }
  }

  // 状态颜色映射
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
      case 'disabled': return 'bg-red-500/10 text-red-400 border-red-500/20'
      case 'unsettled': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'closed': return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
    }
  }

  // 格式化金额
  const formatCurrency = (amount: number | string, currency: string) => {
    if (!amount) return '-'
    // FB 返回的通常是分（如果是 100），或者直接是元。需要确认 API 返回。
    // 假设 API 返回的是分，需要除以 100。
    // 根据 API 文档，balance 通常是 sub-units (e.g. cents)
    const val = Number(amount) / 100
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD'
    }).format(val)
  }

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 relative overflow-hidden">
      {/* 背景光效 */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-white tracking-tight">广告账户管理</h1>
            <span className="bg-slate-800/50 border border-slate-700/50 px-3 py-1 rounded-full text-xs font-medium text-slate-400 backdrop-blur-sm">
              Total: {pagination.total}
            </span>
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`group px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-xl text-sm font-semibold text-white shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transition-all duration-300 flex items-center gap-2 transform hover:-translate-y-0.5 ${syncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <svg className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? '同步中...' : '同步账户'}
            </button>
          </div>
        </header>

        {/* 消息提示 */}
        {message && (
          <div className={`p-4 rounded-xl border backdrop-blur-md flex items-center justify-between shadow-lg animate-fade-in ${
            message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100 p-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* 筛选区域 */}
        <section className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4 items-end">
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2">开始日期</label>
              <input
                type="date"
                value={filters.startDate}
                onChange={e => setFilters({...filters, startDate: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2">结束日期</label>
              <input
                type="date"
                value={filters.endDate}
                onChange={e => setFilters({...filters, endDate: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2">优化师</label>
              <input
                type="text"
                value={filters.optimizer}
                onChange={e => setFilters({...filters, optimizer: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                placeholder="输入名称"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2">账户名称</label>
              <input
                type="text"
                value={filters.name}
                onChange={e => setFilters({...filters, name: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                placeholder="输入账户名称"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2">账户 ID</label>
              <input
                type="text"
                value={filters.accountId}
                onChange={e => setFilters({...filters, accountId: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                placeholder="输入账户ID"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2">状态</label>
              <select
                value={filters.status}
                onChange={e => setFilters({...filters, status: e.target.value})}
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="">全部</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="unsettled">Unsettled</option>
              </select>
            </div>
            <button
              onClick={() => loadAccounts(1)}
              className="w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-medium transition-all"
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
                  <th className="px-6 py-5 font-semibold text-slate-300">账户信息</th>
                  <th className="px-6 py-5 font-semibold text-slate-300">状态</th>
                  <th className="px-6 py-5 font-semibold text-slate-300">余额 / 花费</th>
                  <th className="px-6 py-5 font-semibold text-slate-300">优化师</th>
                  <th className="px-6 py-5 font-semibold text-slate-300 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500 animate-pulse">加载中...</td></tr>
                ) : accounts.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-500">暂无数据</td></tr>
                ) : (
                  accounts.map((account) => (
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
                          <div>余额: <span className="text-emerald-400 font-mono">{formatCurrency(account.balance, account.currency)}</span></div>
                          <div>已用: <span className="text-slate-400 font-mono">{formatCurrency(account.amountSpent || 0, account.currency)}</span></div>
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
                )}
              </tbody>
            </table>
          </div>
          
          {/* 分页 */}
          {pagination.pages > 1 && (
            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                显示 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 共 {pagination.total} 条
              </span>
              <div className="flex gap-2">
                <button
                  disabled={pagination.page === 1}
                  onClick={() => loadAccounts(pagination.page - 1)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-xs text-slate-300"
                >
                  上一页
                </button>
                <button
                  disabled={pagination.page === pagination.pages}
                  onClick={() => loadAccounts(pagination.page + 1)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-xs text-slate-300"
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
