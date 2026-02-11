import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, get } from '../api'
import ActionCard from '../components/ActionCard'

interface Message {
  role: 'user' | 'agent'
  content: string
  toolCalls?: any[]
  actionIds?: string[]
}

const TOPTOU_URL = 'https://toptou.tec-do.com/'
const MB_CARD_ID = '7786'
const MB_ACCESS_CODE = 'VfuSBdaO33sklvtr'

type Panel = 'bi' | 'ads'

function today() { return new Date().toISOString().slice(0, 10) }

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showTools, setShowTools] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<Panel>('bi')
  // BI 数据
  const [biColumns, setBiColumns] = useState<any[]>([])
  const [biRows, setBiRows] = useState<any[]>([])
  const [biLoading, setBiLoading] = useState(false)
  const [biStartDate, setBiStartDate] = useState(today())
  const [biEndDate, setBiEndDate] = useState(today())
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {}) }, [messages])
  useEffect(() => { if (activePanel === 'bi') fetchBiData() }, [])

  const fetchBiData = async () => {
    setBiLoading(true)
    try {
      const params = new URLSearchParams({
        access_code: MB_ACCESS_CODE,
        start_day: biStartDate,
        end_day: biEndDate,
        platform: 'ALL', channel_name: 'ALL',
      })
      const data = await get(`/api/metabase/query/${MB_CARD_ID}?${params}`)
      setBiColumns(data.columns || [])
      setBiRows(data.rows || [])
    } catch (e: any) {
      console.error('BI fetch failed:', e)
    }
    setBiLoading(false)
  }

  const send = async () => {
    if (!input.trim() || loading) return
    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setLoading(true)
    try {
      const data = await post('/api/chat/send', { conversationId, message: msg })
      if (data.conversationId) setConversationId(data.conversationId)
      setMessages(prev => [...prev, {
        role: 'agent', content: data.agentResponse || 'No response',
        toolCalls: data.toolCalls, actionIds: data.actionIds,
      }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', content: `Error: ${e.message}` }])
    }
    setLoading(false)
  }

  const quickActions = [
    { label: '分析广告表现', msg: '帮我分析一下最近 7 天所有广告系列的表现，哪些该扩量、哪些该关停？' },
    { label: '今日数据', msg: '今天的广告花费和 ROAS 怎么样？' },
    { label: '优化建议', msg: '根据最近的数据趋势，给我一些优化建议' },
  ]

  const formatCell = (val: any) => {
    if (val === null || val === undefined) return '-'
    if (typeof val === 'number') {
      if (Math.abs(val) < 0.01 && val !== 0) return val.toFixed(4)
      if (Number.isInteger(val)) return val.toLocaleString()
      return val.toFixed(2)
    }
    return String(val)
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-wide text-blue-400">AutoArk Agent</span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full">
              {pendingCount} 待审批
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { setMessages([]); setConversationId(null) }}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded transition-colors">新对话</button>
          <button onClick={() => { localStorage.removeItem('token'); navigate('/login') }}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors">退出</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ========== 左侧：Agent 对话 ========== */}
        <div className="w-[38%] min-w-[340px] flex flex-col border-r border-slate-700/50">
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-4xl mb-3 opacity-60">🤖</div>
                <h2 className="text-base font-semibold text-slate-300 mb-1">AI 投手</h2>
                <p className="text-xs text-slate-500 mb-5 max-w-xs">分析数据、优化广告、执行操作</p>
                <div className="flex flex-col gap-2 w-full max-w-xs">
                  {quickActions.map((q, i) => (
                    <button key={i} onClick={() => setInput(q.msg)}
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 text-left transition-colors">
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-xl px-3 py-2 ${
                  m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-200'
                }`}>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  {m.actionIds && m.actionIds.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {m.actionIds.map(id => <ActionCard key={id} actionId={id} onUpdate={() => get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})} />)}
                    </div>
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mt-1.5 border-t border-slate-600/30 pt-1.5">
                      <button onClick={() => setShowTools(showTools === `${i}` ? null : `${i}`)}
                        className="text-[10px] text-slate-500 hover:text-slate-300">
                        {showTools === `${i}` ? '▼' : '▶'} {m.toolCalls.length} 工具调用
                      </button>
                      {showTools === `${i}` && m.toolCalls.map((tc: any, j: number) => (
                        <div key={j} className="text-[10px] bg-slate-900/50 rounded p-1.5 mt-1">
                          <span className="font-mono text-blue-400">{tc.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="border-t border-slate-700/50 p-3 bg-slate-800/50">
            <div className="flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="跟 Agent 说..." disabled={loading}
                className="flex-1 px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500 disabled:opacity-40" />
              <button onClick={send} disabled={loading || !input.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40">发送</button>
            </div>
          </div>
        </div>

        {/* ========== 右侧：BI 数据表 / TopTou ========== */}
        <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
          <div className="flex items-center bg-slate-800/60 border-b border-slate-700/50 shrink-0">
            <button onClick={() => setActivePanel('bi')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activePanel === 'bi' ? 'text-blue-400 border-blue-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'
              }`}>📊 BI 数据</button>
            <button onClick={() => setActivePanel('ads')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activePanel === 'ads' ? 'text-emerald-400 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'
              }`}>📢 广告操作</button>
          </div>

          {/* BI 数据表格 */}
          {activePanel === 'bi' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* 筛选栏 */}
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/40 border-b border-slate-700/30">
                <label className="text-[10px] text-slate-400">开始</label>
                <input type="date" value={biStartDate} onChange={e => setBiStartDate(e.target.value)}
                  className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] text-white" />
                <label className="text-[10px] text-slate-400">结束</label>
                <input type="date" value={biEndDate} onChange={e => setBiEndDate(e.target.value)}
                  className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] text-white" />
                <button onClick={fetchBiData} disabled={biLoading}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] rounded transition-colors disabled:opacity-40">
                  {biLoading ? '查询中...' : '查询'}
                </button>
                <span className="text-[10px] text-slate-500 ml-auto">{biRows.length} 行</span>
              </div>
              {/* 表格 */}
              <div className="flex-1 overflow-auto">
                {biLoading ? (
                  <div className="flex items-center justify-center h-40 text-sm text-slate-500">加载中...</div>
                ) : biRows.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-sm text-slate-500">暂无数据</div>
                ) : (
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 bg-slate-800 z-10">
                      <tr>
                        {biColumns.map((col, i) => (
                          <th key={i} className="px-2 py-1.5 text-left text-slate-400 font-medium border-b border-slate-700 whitespace-nowrap">
                            {col.displayName || col.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {biRows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-slate-800/50 border-b border-slate-800/30">
                          {row.map((cell: any, ci: number) => (
                            <td key={ci} className="px-2 py-1 text-slate-300 whitespace-nowrap">
                              {formatCell(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TopTou iframe */}
          {activePanel === 'ads' && (
            <div className="flex-1 relative">
              <iframe src={TOPTOU_URL} className="absolute inset-0 w-full h-full border-0" title="TopTou" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
