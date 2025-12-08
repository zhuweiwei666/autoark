import { useState, useEffect } from 'react'
import DatePicker from '../components/DatePicker'
import Loading from '../components/Loading'
import {
  getMaterialRankings,
  getMaterialRecommendations,
  getDecliningMaterials,
  type MaterialMetric,
} from '../services/api'

// 获取今天的日期字符串 (YYYY-MM-DD)
const getToday = () => {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

// 获取7天前的日期
const getSevenDaysAgo = () => {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.toISOString().split('T')[0]
}

// 格式化函数
const formatCurrency = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '-'
  return `$${v.toFixed(2)}`
}

const formatNumber = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '-'
  return v.toLocaleString()
}

const formatPercent = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '-'
  return `${v.toFixed(2)}%`
}

// 质量评分颜色
const getQualityColor = (score: number) => {
  if (score >= 80) return 'text-emerald-600 bg-emerald-50'
  if (score >= 60) return 'text-blue-600 bg-blue-50'
  if (score >= 40) return 'text-amber-600 bg-amber-50'
  return 'text-red-600 bg-red-50'
}

// ROAS 颜色
const getRoasColor = (roas: number) => {
  if (roas >= 2) return 'text-emerald-600'
  if (roas >= 1) return 'text-blue-600'
  if (roas >= 0.5) return 'text-amber-600'
  return 'text-red-600'
}

// Tab 类型
type TabType = 'rankings' | 'recommendations' | 'declining'

export default function MaterialMetricsPage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [activeTab, setActiveTab] = useState<TabType>('rankings')

  // 数据状态
  const [materials, setMaterials] = useState<MaterialMetric[]>([])
  const [recommendations, setRecommendations] = useState<MaterialMetric[]>([])
  const [decliningMaterials, setDecliningMaterials] = useState<any[]>([])

  // 筛选条件
  const [filters, setFilters] = useState({
    startDate: getSevenDaysAgo(),
    endDate: getToday(),
    sortBy: 'roas' as 'roas' | 'spend' | 'qualityScore' | 'impressions',
    type: '' as '' | 'image' | 'video',
    limit: 50,
  })

  // 加载素材排行榜
  const loadRankings = async () => {
    setLoading(true)
    try {
      const response = await getMaterialRankings({
        startDate: filters.startDate,
        endDate: filters.endDate,
        sortBy: filters.sortBy,
        type: filters.type || undefined,
        limit: filters.limit,
      })
      setMaterials(response.data || [])
      setMessage(null)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载素材数据失败' })
    } finally {
      setLoading(false)
    }
  }

  // 加载推荐素材
  const loadRecommendations = async () => {
    setLoading(true)
    try {
      const response = await getMaterialRecommendations({
        type: filters.type || undefined,
        limit: 30,
      })
      setRecommendations(response.data?.recommendations || [])
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载推荐素材失败' })
    } finally {
      setLoading(false)
    }
  }

  // 加载下滑素材
  const loadDeclining = async () => {
    setLoading(true)
    try {
      const response = await getDecliningMaterials({ limit: 30 })
      setDecliningMaterials(response.data?.decliningMaterials || [])
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载下滑素材失败' })
    } finally {
      setLoading(false)
    }
  }

  // 刷新数据（只从服务器获取）
  const handleSync = async () => {
    setSyncing(true)
    try {
      await loadRankings()
      setMessage({ type: 'success', text: '数据已刷新' })
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '刷新失败' })
    } finally {
      setSyncing(false)
    }
  }

  // 根据当前 tab 加载数据
  
  useEffect(() => {
    if (activeTab === 'rankings') {
      loadRankings()
    } else if (activeTab === 'recommendations') {
      loadRecommendations()
    } else if (activeTab === 'declining') {
      loadDeclining()
    }
  }, [activeTab, filters.startDate, filters.endDate, filters.sortBy, filters.type])

  // Tab 配置
  const tabs = [
    { key: 'rankings' as TabType, label: '素材排行', icon: '🏆' },
    { key: 'recommendations' as TabType, label: '推荐素材', icon: '💡' },
    { key: 'declining' as TabType, label: '下滑预警', icon: '⚠️' },
  ]

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 relative overflow-hidden">
      <div className="relative z-10 max-w-7xl mx-auto space-y-6">
        {/* 页面标题 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
              素材数据
            </h1>
            <p className="text-sm text-slate-500 mt-1">分析广告素材表现，发现爆款素材</p>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 active:scale-95"
            >
              {syncing ? (
                <>
                  <Loading.Spinner size="sm" color="white" />
                  <span>刷新中...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                <span>刷新数据</span>
              </>
            )}
          </button>
          </div>
        </header>

        {/* 消息提示 */}
        {message && (
          <div className={`p-5 rounded-3xl border shadow-xl animate-fade-in ${
            message.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {message.type === 'success' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                )}
                <span className="font-medium">{message.text}</span>
              </div>
              <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100 p-2 hover:bg-white/50 rounded-xl transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* Tab 切换 */}
        <div className="bg-white rounded-3xl p-1.5 shadow-lg shadow-black/5 border border-slate-200 inline-flex">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 统计信息 - 放在标签和筛选栏中间 */}
        {activeTab === 'rankings' && materials.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-slate-900">{materials.length}</div>
            <div className="text-xs text-slate-500">素材总数</div>
          </div>
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">
              ${materials.reduce((sum, m) => sum + (m.spend || 0), 0).toFixed(0)}
            </div>
            <div className="text-xs text-slate-500">总消耗</div>
          </div>
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-emerald-600">
              ${materials.reduce((sum, m) => sum + (m.purchaseValue || 0), 0).toFixed(0)}
            </div>
            <div className="text-xs text-slate-500">总收入</div>
          </div>
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-2xl font-bold text-blue-600">
              {materials.filter(m => m.roas >= 1).length}
            </div>
            <div className="text-xs text-slate-500">盈利素材 (ROAS≥1)</div>
          </div>
          </div>
        )}

        {/* 筛选条件 - 仅在排行榜 tab 显示 */}
        {activeTab === 'rankings' && (
          <section className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            {/* 开始日期 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">开始日期</label>
              <DatePicker
                value={filters.startDate}
                onChange={(date: string) => setFilters({ ...filters, startDate: date })}
              />
            </div>

            {/* 结束日期 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">结束日期</label>
              <DatePicker
                value={filters.endDate}
                onChange={(date: string) => setFilters({ ...filters, endDate: date })}
              />
            </div>

            {/* 素材类型 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">素材类型</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value as any })}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all appearance-none cursor-pointer shadow-sm"
              >
                <option value="">全部类型</option>
                <option value="image">图片</option>
                <option value="video">视频</option>
              </select>
            </div>

            {/* 排序方式 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">排序方式</label>
              <select
                value={filters.sortBy}
                onChange={(e) => setFilters({ ...filters, sortBy: e.target.value as any })}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all appearance-none cursor-pointer shadow-sm"
              >
                <option value="roas">ROAS (高到低)</option>
                <option value="spend">消耗 (高到低)</option>
                <option value="qualityScore">质量分 (高到低)</option>
                <option value="impressions">展示 (高到低)</option>
              </select>
            </div>

            {/* 显示数量 */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-2">显示数量</label>
              <select
                value={filters.limit}
                onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value) })}
                className="w-full px-4 py-3 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition-all appearance-none cursor-pointer shadow-sm"
              >
                <option value="20">20 条</option>
                <option value="50">50 条</option>
                <option value="100">100 条</option>
              </select>
            </div>
          </div>
          </section>
        )}

        {/* 数据表格 */}
        <section className="bg-white rounded-3xl shadow-lg shadow-black/5 border border-slate-200 overflow-hidden">
        {loading ? (
          <Loading.Overlay message="加载素材数据..." size="md" />
        ) : (
          <>
            {/* 排行榜 Tab */}
            {activeTab === 'rankings' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">素材</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">类型</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">消耗</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">收入</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">ROAS</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">展示</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">点击</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">CTR</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">安装</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">CPI</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">质量分</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">活跃天数</th>
                      <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">广告数</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {materials.length === 0 ? (
                      <tr>
                        <td colSpan={13} className="px-6 py-12 text-center text-slate-500">
                          <div className="flex flex-col items-center gap-2">
                            <span className="text-4xl">📊</span>
                            <span>暂无素材数据</span>
                            <span className="text-xs text-slate-400">请先同步素材数据或调整筛选条件</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      materials.map((m, idx) => (
                        <tr key={m.materialKey || idx} className="hover:bg-blue-50/30 transition-colors">
<td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                              {/* 优先使用本地存储 URL（R2），其次使用缩略图 URL */}
                                              {(m.localStorageUrl || m.thumbnailUrl || m.originalUrl) ? (
                                                <a 
                                                  href={m.localStorageUrl || m.thumbnailUrl || m.originalUrl} 
                                                  target="_blank" 
                                                  rel="noopener noreferrer" 
                                                  className="flex-shrink-0 relative group"
                                                  title="点击查看大图"
                                                >
                                                  <img 
                                                    src={m.localStorageUrl || m.thumbnailUrl || m.originalUrl} 
                                                    alt={m.materialName || '素材预览'} 
                                                    className="w-14 h-14 rounded-lg object-cover shadow-sm border border-slate-200 group-hover:scale-105 group-hover:shadow-md transition-all cursor-pointer"
                                                    onError={(e) => {
                                                      // 如果加载失败，尝试使用备用 URL
                                                      const img = e.target as HTMLImageElement
                                                      const fallbackUrl = m.thumbnailUrl || m.originalUrl
                                                      if (img.src !== fallbackUrl && fallbackUrl) {
                                                        img.src = fallbackUrl
                                                      } else {
                                                        img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23cbd5e1"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>'
                                                      }
                                                    }}
                                                  />
                                                  {/* 本地存储标识 */}
                                                  {m.localStorageUrl && (
                                                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center text-white text-[8px] shadow">
                                                      ✓
                                                    </span>
                                                  )}
                                                </a>
                                              ) : (
                                                <div className="w-14 h-14 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 flex-shrink-0">
                                                  {m.materialType === 'video' ? '🎬' : '🖼️'}
                                                </div>
                                              )}
                                              <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium text-slate-900 truncate max-w-[160px]" title={m.materialName || m.fingerprint || m.materialKey}>
                                                  {m.materialName || (m.fingerprint ? `#${m.fingerprint.slice(0, 8)}` : `素材 ${m.materialKey?.slice(-8) || ''}`)}
                                                </div>
                                                <div className="flex items-center gap-2 mt-1">
                                                  {m.localStorageUrl ? (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-600 rounded">
                                                      ✓ 已下载
                                                    </span>
                                                  ) : m.thumbnailUrl || m.originalUrl ? (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-600 rounded">
                                                      待下载
                                                    </span>
                                                  ) : (
                                                    <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-600 rounded">
                                                      无素材
                                                    </span>
                                                  )}
                                                  {m.optimizers && m.optimizers.length > 0 && (
                                                    <span className="text-xs text-blue-600">
                                                      {m.optimizers.slice(0, 2).join(', ')}
                                                      {m.optimizers.length > 2 && ` +${m.optimizers.length - 2}`}
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                              m.materialType === 'video' 
                                ? 'bg-blue-50 text-blue-600' 
                                : 'bg-amber-50 text-amber-600'
                            }`}>
                              {m.materialType === 'video' ? '视频' : '图片'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-sm font-medium text-slate-900">
                            {formatCurrency(m.spend)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm font-medium text-emerald-600">
                            {formatCurrency(m.purchaseValue)}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className={`text-sm font-bold ${getRoasColor(m.roas)}`}>
                              {m.roas?.toFixed(2) || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatNumber(m.impressions)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatNumber(m.clicks)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatPercent(m.ctr)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatNumber(m.installs)}
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {formatCurrency(m.cpi)}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${getQualityColor(m.qualityScore)}`}>
                              {m.qualityScore}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {m.daysActive} 天
                          </td>
                          <td className="px-4 py-4 text-right text-sm text-slate-600">
                            {m.uniqueAdsCount}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* 推荐素材 Tab */}
            {activeTab === 'recommendations' && (
              <div className="p-6">
                <div className="mb-4 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                  <div className="flex items-center gap-2 text-blue-700">
                    <span>💡</span>
                    <span className="font-medium">推荐标准：消耗 ≥ $50, ROAS ≥ 1.0, 活跃天数 ≥ 3 天</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recommendations.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-slate-500">
                      <span className="text-4xl block mb-2">🔍</span>
                      <span>暂无推荐素材</span>
                    </div>
                  ) : (
                    recommendations.map((m: any, idx) => (
                      <div key={m.creativeId || idx} className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start gap-3">
                          {m.thumbnailUrl ? (
                            <img 
                              src={m.thumbnailUrl} 
                              alt="" 
                              className="w-16 h-16 rounded-xl object-cover shadow-sm"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <div className="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-2xl">
                              {m.materialType === 'video' ? '🎬' : '🖼️'}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                m.materialType === 'video' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                              }`}>
                                {m.materialType === 'video' ? '视频' : '图片'}
                              </span>
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${getQualityColor(m.qualityScore || 50)}`}>
                                {m.qualityScore}分
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 truncate">{m.creativeId?.slice(0, 16)}...</div>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                          <div className="p-2 bg-slate-50 rounded-lg">
                            <div className={`text-sm font-bold ${getRoasColor(m.roas)}`}>{m.roas?.toFixed(2)}</div>
                            <div className="text-xs text-slate-500">ROAS</div>
                          </div>
                          <div className="p-2 bg-slate-50 rounded-lg">
                            <div className="text-sm font-bold text-slate-900">${m.spend?.toFixed(0)}</div>
                            <div className="text-xs text-slate-500">消耗</div>
                          </div>
                          <div className="p-2 bg-slate-50 rounded-lg">
                            <div className="text-sm font-bold text-slate-900">{m.daysActive}天</div>
                            <div className="text-xs text-slate-500">活跃</div>
                          </div>
                        </div>
                        {m.reason && (
                          <div className="mt-2 text-xs text-slate-500 text-center">
                            {m.reason}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 下滑预警 Tab */}
            {activeTab === 'declining' && (
              <div className="p-6">
                <div className="mb-4 p-4 bg-gradient-to-r from-red-50 to-amber-50 rounded-2xl border border-red-100">
                  <div className="flex items-center gap-2 text-red-700">
                    <span>⚠️</span>
                    <span className="font-medium">预警标准：最近3天 vs 前4天，ROAS 下降超过 30%</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gradient-to-r from-red-50/80 to-amber-50/80 border-b border-slate-200/60">
                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">素材</th>
                        <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">类型</th>
                        <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">最近3天ROAS</th>
                        <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">前4天ROAS</th>
                        <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">变化</th>
                        <th className="px-4 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">消耗</th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-slate-600 uppercase tracking-wider">建议</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {decliningMaterials.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                            <div className="flex flex-col items-center gap-2">
                              <span className="text-4xl">✅</span>
                              <span>暂无下滑预警</span>
                              <span className="text-xs text-slate-400">所有素材表现稳定</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        decliningMaterials.map((m, idx) => (
                          <tr key={m.creativeId || idx} className="hover:bg-red-50/30 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                {m.thumbnailUrl ? (
                                  <img 
                                    src={m.thumbnailUrl} 
                                    alt="" 
                                    className="w-10 h-10 rounded-lg object-cover shadow-sm border border-slate-200"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
                                    {m.materialType === 'video' ? '🎬' : '🖼️'}
                                  </div>
                                )}
                                <div className="text-xs text-slate-400 truncate max-w-[100px]">
                                  {m.creativeId?.slice(0, 12)}...
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                m.materialType === 'video' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                              }`}>
                                {m.materialType === 'video' ? '视频' : '图片'}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className={`text-sm font-bold ${getRoasColor(m.recentRoas)}`}>
                                {m.recentRoas?.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-slate-600">
                              {m.olderRoas?.toFixed(2)}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <span className="text-sm font-bold text-red-600">
                                {m.roasChange?.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right text-sm text-slate-900">
                              ${m.recentSpend?.toFixed(2)}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                m.suggestion === '建议暂停' 
                                  ? 'bg-red-100 text-red-700' 
                                  : 'bg-amber-100 text-amber-700'
                              }`}>
                                {m.suggestion}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
        </section>
      </div>
    </div>
  )
}

