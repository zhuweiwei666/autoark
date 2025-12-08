import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAccounts } from '../services/api'
import DatePicker from '../components/DatePicker'
import Loading from '../components/Loading'

export default function FacebookAccountsPage() {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> } | null>(null)

  // 分页状态
  const [page, setPage] = useState(1)
  const limit = 20
  
  // 排序状态 - 默认按消耗降序
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'periodSpend', direction: 'desc' })

  // 筛选条件
  const [filters, setFilters] = useState({
    optimizer: '',
    status: '',
    accountId: '',
    name: '',
    startDate: '',
    endDate: ''
  })

  // 使用 React Query 获取账户数据
  // 策略：有缓存直接显示，5分钟内不重复请求；超过5分钟后台静默刷新
  const { data, isLoading: loading, isFetching } = useQuery({
    queryKey: ['accounts', { page, limit, ...filters, sortBy: sortConfig.key, sortOrder: sortConfig.direction }],
    queryFn: () => getAccounts({
      page,
      limit,
      ...filters,
      sortBy: sortConfig.key,
      sortOrder: sortConfig.direction,
    }),
    // 使用全局默认配置：staleTime=5分钟, refetchOnMount=true, placeholderData
  })

  const accounts = data?.data || []
  const pagination = data?.pagination || { page: 1, limit: 20, total: 0, pages: 1 }

  // 刷新数据 mutation（只从服务器获取，不调用 Facebook API）
  const syncMutation = useMutation({
    mutationFn: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      return { success: true }
    },
    onSuccess: () => {
      setMessage({ type: 'success', text: '数据已刷新' })
    },
    onError: (error: any) => {
      setMessage({ type: 'error', text: error.message || '刷新失败' })
    }
  })

  const handleSync = () => {
    setMessage(null)
    syncMutation.mutate()
  }

  const loadAccounts = (newPage: number) => {
    setPage(newPage)
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
            {isFetching && !loading && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 animate-pulse">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                更新中...
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className={`group px-6 py-3 bg-slate-900 hover:bg-slate-800 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95 ${syncMutation.isPending ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <svg className={`w-5 h-5 ${syncMutation.isPending ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncMutation.isPending ? '刷新中...' : '刷新数据'}
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
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">开始日期</label>
              <DatePicker
                value={filters.startDate}
                onChange={(date) => setFilters({...filters, startDate: date})}
                placeholder="选择开始日期"
                className="w-full"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">结束日期</label>
              <DatePicker
                value={filters.endDate}
                onChange={(date) => setFilters({...filters, endDate: date})}
                placeholder="选择结束日期"
                className="w-full"
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
        <section className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-black/5 border border-slate-200">
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
                      const direction = sortConfig?.key === 'periodSpend' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      setSortConfig({ key: 'periodSpend', direction })
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>{filters.startDate || filters.endDate ? '期间消耗' : '当日消耗'}</span>
                      {sortConfig?.key === 'periodSpend' && (
                        <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                        </svg>
                      )}
                      {sortConfig?.key !== 'periodSpend' && (
                        <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors select-none"
                    onClick={() => {
                      const direction = sortConfig?.key === 'calculatedBalance' && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                      setSortConfig({ key: 'calculatedBalance', direction })
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>余额</span>
                      {sortConfig?.key === 'calculatedBalance' && (
                        <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                        </svg>
                      )}
                      {sortConfig?.key !== 'calculatedBalance' && (
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
                  <tr><td colSpan={7} className="px-6 py-12">
                    <Loading.Inline message="加载账户数据..." size="md" />
                  </td></tr>
                ) : accounts.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-500">暂无数据</td></tr>
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
                        <div className="text-slate-300 text-xs">
                          {account.periodSpend !== undefined && account.periodSpend > 0 ? (
                            <span className="text-slate-400 font-mono">${account.periodSpend.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-500">$0.00</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-slate-300 text-xs">
                          {account.calculatedBalance !== undefined ? (
                            <span className="text-emerald-400 font-mono">${account.calculatedBalance.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-500">-</span>
                          )}
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
