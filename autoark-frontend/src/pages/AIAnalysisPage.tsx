import { useState, useEffect } from 'react'

interface HealthData {
  healthScore: number
  trend: Array<{ _id: string; spend: number; revenue: number; roas: number }>
  summary: { totalSpend: number; totalRevenue: number; avgRoas: number; days: number }
  status: 'healthy' | 'attention' | 'critical'
}

interface Report {
  _id: string
  date: string
  summary: {
    totalSpend: number
    totalRevenue: number
    avgRoas: number
    activeCampaigns: number
    profitableCampaigns: number
    losingCampaigns: number
  }
  trends: { spendChange: number; roasChange: number; revenueChange: number }
  alerts: Array<{ type: string; severity: string; message: string }>
  topPerformers: Array<{ entityName: string; roas: number; spend: number }>
  needsAttention: Array<{ entityName: string; issue: string; suggestion: string }>
  aiSummary: string
  aiRecommendations: string[]
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function AIAnalysisPage() {
  const [activeTab, setActiveTab] = useState<'health' | 'chat' | 'reports'>('health')
  const [healthData, setHealthData] = useState<HealthData | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chatLoading, setChatLoading] = useState(false)

  useEffect(() => {
    loadHealthData()
    loadReports()
  }, [])

  const loadHealthData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agent/analysis/health')
      const data = await res.json()
      if (data.success) setHealthData(data.data)
    } catch (error) {
      console.error('Failed to load health data:', error)
    }
    setLoading(false)
  }

  const loadReports = async () => {
    try {
      const res = await fetch('/api/agent/reports?limit=7')
      const data = await res.json()
      if (data.success) setReports(data.data)
    } catch (error) {
      console.error('Failed to load reports:', error)
    }
  }

  const generateReport = async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await fetch('/api/agent/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today }),
      })
      await loadReports()
    } catch (error) {
      console.error('Failed to generate report:', error)
    }
    setLoading(false)
  }

  const sendChat = async () => {
    if (!chatInput.trim()) return
    
    const userMessage = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setChatLoading(true)

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })
      const data = await res.json()
      if (data.success) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.data.response }])
      }
    } catch (error) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: '抱歉，处理请求时出错了。' }])
    }
    setChatLoading(false)
  }

  const getHealthColor = (score: number) => {
    if (score >= 70) return 'from-emerald-400 to-green-500'
    if (score >= 40) return 'from-amber-400 to-orange-500'
    return 'from-red-400 to-rose-500'
  }

  const getHealthText = (status: string) => {
    if (status === 'healthy') return '健康'
    if (status === 'attention') return '需关注'
    return '警告'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
          AI 智能分析
        </h1>
        <p className="text-slate-400 mt-2">由 Gemini 2.0 Flash 提供支持</p>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-6">
        {[
          { key: 'health', label: '健康度分析', icon: '💊' },
          { key: 'chat', label: 'AI 对话', icon: '💬' },
          { key: 'reports', label: '智能报告', icon: '📊' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-6 py-3 rounded-2xl font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border border-white/20 shadow-lg shadow-blue-500/10'
                : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white border border-transparent'
            }`}
          >
            <span className="mr-2">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 健康度分析 */}
      {activeTab === 'health' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 健康度得分 */}
          <div className="lg:col-span-1">
            <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-8 text-center">
              {loading ? (
                <div className="animate-pulse">
                  <div className="w-40 h-40 mx-auto rounded-full bg-white/10"></div>
                </div>
              ) : healthData ? (
                <>
                  <div className="relative w-40 h-40 mx-auto mb-6">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="80" cy="80" r="70"
                        fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="12"
                      />
                      <circle
                        cx="80" cy="80" r="70"
                        fill="none"
                        stroke="url(#healthGradient)"
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={`${healthData.healthScore * 4.4} 440`}
                      />
                      <defs>
                        <linearGradient id="healthGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#22d3ee" />
                          <stop offset="100%" stopColor="#8b5cf6" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-4xl font-bold text-white">{healthData.healthScore}</span>
                      <span className="text-sm text-slate-400">分</span>
                    </div>
                  </div>
                  <div className={`inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r ${getHealthColor(healthData.healthScore)}`}>
                    <span className="text-white font-medium">{getHealthText(healthData.status)}</span>
                  </div>
                  <div className="mt-6 text-slate-400 text-sm">
                    近 {healthData.summary.days} 天数据分析
                  </div>
                </>
              ) : (
                <div className="text-slate-500">无数据</div>
              )}
            </div>
          </div>

          {/* 关键指标 */}
          <div className="lg:col-span-2">
            <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">关键指标趋势</h3>
              {healthData && (
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-white/5 rounded-2xl p-4">
                    <div className="text-slate-400 text-sm mb-1">总消耗</div>
                    <div className="text-2xl font-bold text-white">${healthData.summary.totalSpend.toFixed(2)}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4">
                    <div className="text-slate-400 text-sm mb-1">总收入</div>
                    <div className="text-2xl font-bold text-emerald-400">${healthData.summary.totalRevenue.toFixed(2)}</div>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4">
                    <div className="text-slate-400 text-sm mb-1">平均 ROAS</div>
                    <div className="text-2xl font-bold text-cyan-400">{healthData.summary.avgRoas.toFixed(2)}</div>
                  </div>
                </div>
              )}
              
              {/* 趋势图 */}
              {healthData && healthData.trend.length > 0 && (
                <div className="h-48 flex items-end gap-2">
                  {healthData.trend.map((day, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center">
                      <div 
                        className="w-full bg-gradient-to-t from-blue-500/50 to-purple-500/50 rounded-t-lg transition-all hover:from-blue-500 hover:to-purple-500"
                        style={{ height: `${Math.max(10, (day.roas / 3) * 100)}%` }}
                      ></div>
                      <div className="text-xs text-slate-500 mt-2">{day._id.slice(5)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI 对话 */}
      {activeTab === 'chat' && (
        <div className="max-w-4xl mx-auto">
          <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 overflow-hidden">
            {/* 对话区域 */}
            <div className="h-[500px] overflow-y-auto p-6 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center text-slate-500 py-20">
                  <div className="text-6xl mb-4">🤖</div>
                  <p>你好！我是 AutoArk AI 助手。</p>
                  <p className="text-sm mt-2">你可以问我任何关于广告投放的问题。</p>
                  <div className="flex flex-wrap gap-2 justify-center mt-6">
                    {['今天的投放表现怎么样？', '哪些广告系列需要优化？', '分析一下 ROAS 趋势'].map(q => (
                      <button
                        key={q}
                        onClick={() => { setChatInput(q); sendChat(); }}
                        className="px-4 py-2 bg-white/10 rounded-full text-sm hover:bg-white/20 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white'
                        : 'bg-white/10 text-slate-200'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                </div>
              ))}
              
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white/10 rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 输入区域 */}
            <div className="border-t border-white/10 p-4">
              <div className="flex gap-4">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  placeholder="输入你的问题..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <button
                  onClick={sendChat}
                  disabled={chatLoading}
                  className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-2xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 智能报告 */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">历史报告</h3>
            <button
              onClick={generateReport}
              disabled={loading}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-xl font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? '生成中...' : '生成今日报告'}
            </button>
          </div>

          {reports.length === 0 ? (
            <div className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-12 text-center text-slate-500">
              <div className="text-4xl mb-4">📊</div>
              <p>暂无报告，点击上方按钮生成</p>
            </div>
          ) : (
            <div className="space-y-4">
              {reports.map(report => (
                <div key={report._id} className="backdrop-blur-2xl bg-white/[0.03] rounded-3xl border border-white/10 p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-lg font-semibold text-white">{report.date}</div>
                      <div className="text-sm text-slate-400">
                        {report.summary.activeCampaigns} 个活跃广告系列
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {report.alerts?.map((alert, i) => (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded-lg text-xs ${
                            alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                            alert.severity === 'warning' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {alert.message}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div>
                      <div className="text-slate-400 text-xs">消耗</div>
                      <div className="text-white font-semibold">${report.summary.totalSpend.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs">收入</div>
                      <div className="text-emerald-400 font-semibold">${report.summary.totalRevenue.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs">ROAS</div>
                      <div className="text-cyan-400 font-semibold">{report.summary.avgRoas.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs">盈利广告</div>
                      <div className="text-white font-semibold">{report.summary.profitableCampaigns} 个</div>
                    </div>
                  </div>

                  {report.aiSummary && (
                    <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-2xl p-4 border border-white/5">
                      <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
                        <span>🤖</span>
                        <span>AI 分析</span>
                      </div>
                      <p className="text-white">{report.aiSummary}</p>
                      {report.aiRecommendations?.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {report.aiRecommendations.map((rec, i) => (
                            <li key={i} className="text-slate-300 text-sm flex items-start gap-2">
                              <span className="text-cyan-400">•</span>
                              {rec}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
