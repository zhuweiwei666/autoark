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
    loadChatHistory()
  }, [])

  // 加载聊天历史
  const loadChatHistory = async () => {
    try {
      const res = await fetch('/api/agent/chat/history?limit=1')
      const data = await res.json()
      if (data.success && data.data.length > 0) {
        // 获取最近的会话消息
        const recentConversation = data.data[0]
        if (recentConversation.messages && recentConversation.messages.length > 0) {
          const messages = recentConversation.messages.map((m: any) => ({
            role: m.role,
            content: m.content
          }))
          setChatMessages(messages)
        }
      }
    } catch (error) {
      console.error('Failed to load chat history:', error)
    }
  }

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
    if (score >= 70) return 'text-emerald-600'
    if (score >= 40) return 'text-amber-600'
    return 'text-red-600'
  }

  const getHealthBg = (score: number) => {
    if (score >= 70) return 'bg-emerald-100 text-emerald-700'
    if (score >= 40) return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-700'
  }

  const getHealthText = (status: string) => {
    if (status === 'healthy') return '健康'
    if (status === 'attention') return '需关注'
    return '警告'
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <h1 className="text-3xl font-bold text-slate-900">AI 智能分析</h1>
          <p className="text-slate-500 mt-1">由 Gemini 2.0 Flash 提供支持</p>
        </header>

        {/* Tab 切换 */}
        <div className="flex gap-2">
          {[
            { key: 'health', label: '健康度分析', icon: '💊' },
            { key: 'chat', label: 'AI 对话', icon: '💬' },
            { key: 'reports', label: '智能报告', icon: '📊' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-6 py-3 rounded-xl font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
              <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center shadow-lg shadow-black/5">
                {loading ? (
                  <div className="animate-pulse">
                    <div className="w-40 h-40 mx-auto rounded-full bg-slate-100"></div>
                  </div>
                ) : healthData ? (
                  <>
                    <div className="relative w-40 h-40 mx-auto mb-6">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle
                          cx="80" cy="80" r="70"
                          fill="none" stroke="#e2e8f0" strokeWidth="12"
                        />
                        <circle
                          cx="80" cy="80" r="70"
                          fill="none"
                          stroke={healthData.healthScore >= 70 ? '#10b981' : healthData.healthScore >= 40 ? '#f59e0b' : '#ef4444'}
                          strokeWidth="12"
                          strokeLinecap="round"
                          strokeDasharray={`${healthData.healthScore * 4.4} 440`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className={`text-4xl font-bold ${getHealthColor(healthData.healthScore)}`}>
                          {healthData.healthScore}
                        </span>
                        <span className="text-sm text-slate-400">分</span>
                      </div>
                    </div>
                    <div className={`inline-flex items-center px-4 py-2 rounded-full ${getHealthBg(healthData.healthScore)}`}>
                      <span className="font-medium">{getHealthText(healthData.status)}</span>
                    </div>
                    <div className="mt-4 text-slate-500 text-sm">
                      近 {healthData.summary.days} 天数据分析
                    </div>
                  </>
                ) : (
                  <div className="text-slate-400">无数据</div>
                )}
              </div>
            </div>

            {/* 关键指标 */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg shadow-black/5">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">关键指标趋势</h3>
                {healthData && (
                  <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                      <div className="text-slate-500 text-sm mb-1">总消耗</div>
                      <div className="text-2xl font-bold text-slate-900">${healthData.summary.totalSpend.toFixed(2)}</div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                      <div className="text-slate-500 text-sm mb-1">总收入</div>
                      <div className="text-2xl font-bold text-emerald-600">${healthData.summary.totalRevenue.toFixed(2)}</div>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                      <div className="text-slate-500 text-sm mb-1">平均 ROAS</div>
                      <div className="text-2xl font-bold text-indigo-600">{healthData.summary.avgRoas.toFixed(2)}</div>
                    </div>
                  </div>
                )}
                
                {/* 趋势图 */}
                {healthData && healthData.trend.length > 0 && (
                  <div className="h-48 flex items-end gap-2 bg-slate-50 rounded-2xl p-4">
                    {healthData.trend.map((day, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center">
                        <div 
                          className="w-full bg-gradient-to-t from-indigo-500 to-indigo-400 rounded-t-lg transition-all hover:from-indigo-600 hover:to-indigo-500"
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
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-lg shadow-black/5">
              {/* 对话区域 */}
              <div className="h-[500px] overflow-y-auto p-6 space-y-4 bg-slate-50">
                {chatMessages.length === 0 && (
                  <div className="text-center text-slate-400 py-20">
                    <div className="text-6xl mb-4">🤖</div>
                    <p className="text-slate-600">你好！我是 AutoArk AI 助手。</p>
                    <p className="text-sm mt-2">你可以问我任何关于广告投放的问题。</p>
                    <div className="flex flex-wrap gap-2 justify-center mt-6">
                      {['今天的投放表现怎么样？', '哪些广告系列需要优化？', '分析一下 ROAS 趋势'].map(q => (
                        <button
                          key={q}
                          onClick={() => { setChatInput(q); }}
                          className="px-4 py-2 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors shadow-sm"
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
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white text-slate-700 border border-slate-200 shadow-sm'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    </div>
                  </div>
                ))}
                
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-sm">
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
              <div className="border-t border-slate-200 p-4 bg-white">
                <div className="flex gap-4">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                    placeholder="输入你的问题..."
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <button
                    onClick={sendChat}
                    disabled={chatLoading}
                    className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-lg shadow-indigo-200"
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
              <h3 className="text-lg font-semibold text-slate-900">历史报告</h3>
              <button
                onClick={generateReport}
                disabled={loading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-lg shadow-indigo-200"
              >
                {loading ? '生成中...' : '生成今日报告'}
              </button>
            </div>

            {reports.length === 0 ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center text-slate-400 shadow-lg shadow-black/5">
                <div className="text-4xl mb-4">📊</div>
                <p className="text-slate-600">暂无报告，点击上方按钮生成</p>
              </div>
            ) : (
              <div className="space-y-4">
                {reports.map(report => (
                  <div key={report._id} className="bg-white rounded-3xl border border-slate-200 p-6 shadow-lg shadow-black/5">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{report.date}</div>
                        <div className="text-sm text-slate-500">
                          {report.summary.activeCampaigns} 个活跃广告系列
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {report.alerts?.map((alert, i) => (
                          <span
                            key={i}
                            className={`px-2 py-1 rounded-lg text-xs font-medium ${
                              alert.severity === 'critical' ? 'bg-red-100 text-red-700' :
                              alert.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                              'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {alert.message}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 mb-4">
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-500 text-xs">消耗</div>
                        <div className="text-slate-900 font-semibold">${report.summary.totalSpend.toFixed(2)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-500 text-xs">收入</div>
                        <div className="text-emerald-600 font-semibold">${report.summary.totalRevenue.toFixed(2)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-500 text-xs">ROAS</div>
                        <div className="text-indigo-600 font-semibold">{report.summary.avgRoas.toFixed(2)}</div>
                      </div>
                      <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <div className="text-slate-500 text-xs">盈利广告</div>
                        <div className="text-slate-900 font-semibold">{report.summary.profitableCampaigns} 个</div>
                      </div>
                    </div>

                    {report.aiSummary && (
                      <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
                        <div className="flex items-center gap-2 text-sm text-indigo-600 mb-2">
                          <span>🤖</span>
                          <span className="font-medium">AI 分析</span>
                        </div>
                        <p className="text-slate-700">{report.aiSummary}</p>
                        {report.aiRecommendations?.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {report.aiRecommendations.map((rec, i) => (
                              <li key={i} className="text-slate-600 text-sm flex items-start gap-2">
                                <span className="text-indigo-500">•</span>
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
    </div>
  )
}
