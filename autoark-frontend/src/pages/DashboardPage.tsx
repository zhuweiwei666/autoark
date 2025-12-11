import { useState, useEffect, useRef } from 'react'
// 🚀 使用预聚合表 API，响应速度更快
import { getAggCoreMetrics, getAggTrend, getAggCampaignRanking, getAggAccountRanking } from '../services/api'

// 缓存 key
const getCacheKey = () => `dashboard_7days`

// 从缓存加载数据
const loadFromCache = () => {
  try {
    const cached = localStorage.getItem(getCacheKey())
    if (cached) {
      const data = JSON.parse(cached)
      // 检查缓存是否过期（5分钟）
      if (data.timestamp && Date.now() - data.timestamp < 5 * 60 * 1000) {
        return data
      }
    }
  } catch (e) {
    console.error('Failed to load from cache:', e)
  }
  return null
}

// 保存到缓存
const saveToCache = (data: any) => {
  try {
    localStorage.setItem(getCacheKey(), JSON.stringify({ ...data, timestamp: Date.now() }))
  } catch (e) {
    console.error('Failed to save to cache:', e)
  }
}

export default function DashboardPage() {
  // 数据状态
  const [coreMetrics, setCoreMetrics] = useState<any>(null)
  const [spendTrend, setSpendTrend] = useState<any[]>([])
  const [roasTrend, setRoasTrend] = useState<any[]>([])
  const [campaignRanking, setCampaignRanking] = useState<any[]>([])
  const [accountRanking, setAccountRanking] = useState<any[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 图表引用
  const spendTrendChartRef = useRef<any>(null)
  const roasTrendChartRef = useRef<any>(null)
  const campaignRankingChartRef = useRef<any>(null)
  const accountRankingChartRef = useRef<any>(null)

  // 🚀 使用预聚合表 API，响应速度更快
  const fetchData = async () => {
    setIsRefreshing(true)
    const startTime = performance.now()
    try {
      // 并行获取所有数据（预聚合表，超快）
      const [metricsRes, trendRes, campaignRes, accountRes] = await Promise.all([
        getAggCoreMetrics(),
        getAggTrend(7),
        getAggCampaignRanking(10),
        getAggAccountRanking(10)
      ])

      const data = {
        coreMetrics: metricsRes.data,
        spendTrend: trendRes.data || [],
        roasTrend: trendRes.data || [],  // 趋势数据包含 ROAS
        campaignRanking: campaignRes.data || [],
        accountRanking: accountRes.data || [],
      }
      
      setCoreMetrics(data.coreMetrics)
      setSpendTrend(data.spendTrend)
      setRoasTrend(data.roasTrend)
      setCampaignRanking(data.campaignRanking)
      setAccountRanking(data.accountRanking)
      
      // 保存到缓存
      saveToCache(data)
      
      const duration = (performance.now() - startTime).toFixed(0)
      console.log(`🚀 Dashboard loaded in ${duration}ms (using aggregation tables)`)
    } catch (error: any) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  // 手动刷新（只从服务器获取）
  const handleRefresh = () => {
    fetchData()
  }

  // 初始加载 - 优先使用缓存
  useEffect(() => {
    const cached = loadFromCache()
    if (cached) {
      setCoreMetrics(cached.coreMetrics)
      setSpendTrend(cached.spendTrend)
      setRoasTrend(cached.roasTrend || [])
      setCampaignRanking(cached.campaignRanking)
      setAccountRanking(cached.accountRanking)
    }
    // 始终获取最新数据
    fetchData()
  }, [])

  // 渲染图表
  useEffect(() => {
    // 动态加载 Chart.js
    const loadChart = async () => {
      if (typeof window !== 'undefined' && !(window as any).Chart) {
        const script = document.createElement('script')
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
        script.onload = () => {
          renderCharts()
        }
        document.head.appendChild(script)
      } else {
        renderCharts()
      }
    }

    const renderCharts = () => {
      const Chart = (window as any).Chart
      if (!Chart) return

      // 消耗趋势图
      const trendCtx = document.getElementById('spend-trend-chart') as HTMLCanvasElement
      if (trendCtx) {
        if (spendTrendChartRef.current) {
          spendTrendChartRef.current.destroy()
        }
        const formattedLabels = spendTrend.map(d => {
          const date = new Date(d.date + 'T00:00:00')
          return (date.getMonth() + 1) + '/' + date.getDate()
        })
        spendTrendChartRef.current = new Chart(trendCtx, {
          type: 'line',
          data: {
            labels: formattedLabels,
            datasets: [{
              label: '消耗 ($)',
              data: spendTrend.map(d => d.totalSpend || d.spend || 0),
              borderColor: 'rgb(99, 102, 241)',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 3,
              pointHoverRadius: 5,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8', maxTicksLimit: 10 },
                grid: { display: false },
              },
              y: {
                ticks: { 
                  color: '#94a3b8',
                  callback: (value: any) => '$' + value.toFixed(0)
                },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
                beginAtZero: true,
              },
            },
          },
        })
      }

      // ROAS 趋势图
      const roasCtx = document.getElementById('roas-trend-chart') as HTMLCanvasElement
      if (roasCtx && roasTrend.length > 0) {
        if (roasTrendChartRef.current) {
          roasTrendChartRef.current.destroy()
        }
        const formattedLabels = roasTrend.map(d => {
          const date = new Date(d.date + 'T00:00:00')
          return (date.getMonth() + 1) + '/' + date.getDate()
        })
        roasTrendChartRef.current = new Chart(roasCtx, {
          type: 'line',
          data: {
            labels: formattedLabels,
            datasets: [{
              label: 'ROAS',
              data: roasTrend.map(d => d.roas || 0),
              borderColor: 'rgb(16, 185, 129)',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 3,
              pointHoverRadius: 5,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8', maxTicksLimit: 10 },
                grid: { display: false },
              },
              y: {
                ticks: { 
                  color: '#94a3b8',
                  callback: (value: any) => value.toFixed(2)
                },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
                beginAtZero: true,
              },
            },
          },
        })
      }

      // Campaign 消耗排行（保持后端返回的降序排列：消耗高的在上面）
      const campaignCtx = document.getElementById('campaign-ranking-chart') as HTMLCanvasElement
      if (campaignCtx) {
        if (campaignRankingChartRef.current) {
          campaignRankingChartRef.current.destroy()
        }
        // 不需要反转，后端已经按 spend 降序排列
        const sortedData = campaignRanking
        campaignRankingChartRef.current = new Chart(campaignCtx, {
          type: 'bar',
          data: {
            labels: sortedData.map(d => {
              const name = d.campaignName || d.campaignId || 'Unknown'
              return name.length > 25 ? name.substring(0, 25) + '...' : name
            }),
            datasets: [{
              label: '消耗 ($)',
              data: sortedData.map(d => d.spend || 0),
              backgroundColor: 'rgba(99, 102, 241, 0.8)',
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.5,
            indexAxis: 'y',
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
              y: {
                ticks: { color: '#94a3b8' },
                grid: { display: false },
                reverse: true, // 反转 Y 轴，让消耗最高的显示在最上面
              },
            },
          },
        })
      }

      // 账户消耗排行
      const accountCtx = document.getElementById('account-ranking-chart') as HTMLCanvasElement
      if (accountCtx) {
        if (accountRankingChartRef.current) {
          accountRankingChartRef.current.destroy()
        }
        accountRankingChartRef.current = new Chart(accountCtx, {
          type: 'bar',
          data: {
            labels: accountRanking.map(d => {
              const name = d.accountName || d.accountId || 'Unknown'
              return name.length > 20 ? name.substring(0, 20) + '...' : name
            }),
            datasets: [{
              label: '消耗 ($)',
              data: accountRanking.map(d => d.spend || 0),
              backgroundColor: 'rgba(16, 185, 129, 0.8)',
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: { display: false },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
              y: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
            },
          },
        })
      }
    }

    if (spendTrend.length > 0 || roasTrend.length > 0 || campaignRanking.length > 0 || accountRanking.length > 0) {
      loadChart()
    }
  }, [spendTrend, roasTrend, campaignRanking, accountRanking])

  // 计算今日 vs 昨日变化
  const getTodayChange = () => {
    if (!coreMetrics?.today || !coreMetrics?.yesterday) return '0.0'
    if (coreMetrics.yesterday.spend === 0) return '0.0'
    const change = ((coreMetrics.today.spend - coreMetrics.yesterday.spend) / coreMetrics.yesterday.spend * 100).toFixed(1)
    return change
  }

  const todayChange = getTodayChange()
  const isPositiveChange = parseFloat(todayChange) >= 0

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard <span className="text-xs text-emerald-500">v5-实时</span></h1>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isRefreshing ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>刷新中...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>刷新数据</span>
              </>
            )}
          </button>
        </header>

        {/* 数据看板 */}
        <section className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg shadow-black/5">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900">📊 数据看板</h2>
            <span className="text-sm text-slate-500">最近 7 天数据</span>
          </div>

          {/* 核心指标卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs text-slate-600 mb-1">今日消耗</div>
              <div className="text-2xl font-bold text-slate-900">
                ${(coreMetrics?.today?.spend || 0).toFixed(2)}
              </div>
              <div className={`text-xs mt-1 ${isPositiveChange ? 'text-emerald-700' : 'text-red-700'}`}>
                {todayChange}% vs 昨日
              </div>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs text-slate-600 mb-1">昨日消耗</div>
              <div className="text-2xl font-bold text-slate-900">
                ${(coreMetrics?.yesterday?.spend || 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs text-slate-600 mb-1">7日总消耗</div>
              <div className="text-2xl font-bold text-slate-900">
                ${(coreMetrics?.sevenDays?.spend || 0).toFixed(2)}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                日均: ${(coreMetrics?.sevenDays?.avgDailySpend || 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
              <div className="text-xs text-slate-600 mb-1">今日 ROAS</div>
              <div className="text-2xl font-bold text-slate-900">
                {(coreMetrics?.today?.roas || 0).toFixed(2)}
              </div>
            </div>
          </div>

          {/* 图表区域 - 消耗和 ROAS 趋势 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* 消耗趋势图 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">💰 消耗趋势（按天）</h3>
              <div className="h-64 overflow-hidden">
                <canvas id="spend-trend-chart"></canvas>
              </div>
            </div>

            {/* ROAS 趋势图 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">📈 ROAS 趋势（按天）</h3>
              <div className="h-64 overflow-hidden">
                <canvas id="roas-trend-chart"></canvas>
              </div>
            </div>
          </div>

          {/* 图表区域 - Campaign 排行 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Campaign 消耗排行 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">🏆 Campaign 消耗排行（Top 10）</h3>
              <div className="h-64 overflow-hidden">
                <canvas id="campaign-ranking-chart"></canvas>
              </div>
            </div>

            {/* 账户消耗排行 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">🏦 账户消耗排行（Top 10）</h3>
              <div className="h-64 overflow-hidden">
                <canvas id="account-ranking-chart"></canvas>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
