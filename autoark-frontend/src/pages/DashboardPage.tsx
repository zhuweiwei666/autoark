import { useState, useEffect, useRef } from 'react'
import DatePicker from '../components/DatePicker'
import { getCoreMetrics, getSpendTrend, getCampaignRanking, getAccountRanking } from '../services/api'

// 获取今天的日期字符串 (YYYY-MM-DD)
const getToday = () => {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

// 获取7天前的日期字符串
const getSevenDaysAgo = () => {
  const date = new Date()
  date.setDate(date.getDate() - 7)
  return date.toISOString().split('T')[0]
}

export default function DashboardPage() {
  const today = getToday()
  const sevenDaysAgo = getSevenDaysAgo()

  // 日期筛选 - 默认最近7天
  const [filters, setFilters] = useState({
    startDate: sevenDaysAgo,
    endDate: today
  })

  // 数据状态
  const [coreMetrics, setCoreMetrics] = useState<any>(null)
  const [spendTrend, setSpendTrend] = useState<any[]>([])
  const [campaignRanking, setCampaignRanking] = useState<any[]>([])
  const [accountRanking, setAccountRanking] = useState<any[]>([])

  // 图表引用
  const spendTrendChartRef = useRef<any>(null)
  const campaignRankingChartRef = useRef<any>(null)
  const accountRankingChartRef = useRef<any>(null)

  // 加载数据
  const loadData = async () => {
    try {
      const [metricsRes, trendRes, campaignRes, accountRes] = await Promise.all([
        getCoreMetrics(filters.startDate, filters.endDate),
        getSpendTrend(filters.startDate, filters.endDate),
        getCampaignRanking(10, filters.startDate, filters.endDate),
        getAccountRanking(10, filters.startDate, filters.endDate)
      ])

      setCoreMetrics(metricsRes.data)
      setSpendTrend(trendRes.data || [])
      setCampaignRanking(campaignRes.data || [])
      setAccountRanking(accountRes.data || [])
    } catch (error: any) {
      console.error('Failed to load dashboard data:', error)
    }
  }

  // 初始加载和日期变化时重新加载
  useEffect(() => {
    loadData()
  }, [filters.startDate, filters.endDate])

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
              data: spendTrend.map(d => d.spend || 0),
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

      // Campaign 消耗排行
      const campaignCtx = document.getElementById('campaign-ranking-chart') as HTMLCanvasElement
      if (campaignCtx) {
        if (campaignRankingChartRef.current) {
          campaignRankingChartRef.current.destroy()
        }
        const sortedData = campaignRanking.length === 1 ? campaignRanking : [...campaignRanking].reverse()
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

    if (spendTrend.length > 0 || campaignRanking.length > 0 || accountRanking.length > 0) {
      loadChart()
    }
  }, [spendTrend, campaignRanking, accountRanking])

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
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Dashboard</h1>
        </header>

        {/* 数据看板 */}
        <section className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg shadow-black/5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900">📊 数据看板</h2>
          </div>
          
          {/* 纯白底筛选区域 - 完全复用账户管理页面的样式 */}
          <div className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200 mb-6">
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
            </div>
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

          {/* 图表区域 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 消耗趋势图 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">消耗趋势（按天）</h3>
              <div className="h-64 overflow-hidden">
                <canvas id="spend-trend-chart"></canvas>
              </div>
            </div>

            {/* Campaign 消耗排行 */}
            <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Campaign 消耗排行（Top 10）</h3>
              <div className="h-64 overflow-hidden">
                <canvas id="campaign-ranking-chart"></canvas>
              </div>
            </div>
          </div>

          {/* 账户消耗排行 */}
          <div className="mt-6 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">账户消耗排行（Top 10）</h3>
            <div className="h-48 overflow-hidden">
              <canvas id="account-ranking-chart"></canvas>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

