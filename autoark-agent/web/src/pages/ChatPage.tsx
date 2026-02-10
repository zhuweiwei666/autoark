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

// Metabase 走 Nginx 反向代理（去掉 X-Frame-Options）
const METABASE_URL = '/bi/question/4002-camp-v5-doris?start_day=&end_day=&user_name=&access_code=xheqmmolkpj9f35e&pkg_name=&cam_id=&platform=ALL&channel_name=ALL'
// TopTou 没有 iframe 限制，直接嵌入
const TOPTOU_URL = 'https://toptou.tec-do.com/'

type Panel = 'bi' | 'ads'

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showTools, setShowTools] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<Panel>('bi')
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {}) }, [messages])

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
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded transition-colors">
            新对话
          </button>
          <button onClick={() => { localStorage.removeItem('token'); navigate('/login') }}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors">
            退出
          </button>
        </div>
      </header>

      {/* 主体：左右分栏 */}
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
                  m.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 border border-slate-700 text-slate-200'
                }`}>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>

                  {m.actionIds && m.actionIds.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {m.actionIds.map(id => (
                        <ActionCard key={id} actionId={id} onUpdate={() => get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})} />
                      ))}
                    </div>
                  )}

                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mt-1.5 border-t border-slate-600/30 pt-1.5">
                      <button onClick={() => setShowTools(showTools === `${i}` ? null : `${i}`)}
                        className="text-[10px] text-slate-500 hover:text-slate-300">
                        {showTools === `${i}` ? '▼' : '▶'} {m.toolCalls.length} 工具调用
                      </button>
                      {showTools === `${i}` && (
                        <div className="mt-1 space-y-1">
                          {m.toolCalls.map((tc: any, j: number) => (
                            <div key={j} className="text-[10px] bg-slate-900/50 rounded p-1.5">
                              <span className="font-mono text-blue-400">{tc.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
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

          {/* 输入框 */}
          <div className="border-t border-slate-700/50 p-3 bg-slate-800/50">
            <div className="flex gap-2">
              <input
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="跟 Agent 说..."
                disabled={loading}
                className="flex-1 px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500 disabled:opacity-40"
              />
              <button onClick={send} disabled={loading || !input.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40">
                发送
              </button>
            </div>
          </div>
        </div>

        {/* ========== 右侧：双 iframe ========== */}
        <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
          {/* 标签栏 */}
          <div className="flex items-center bg-slate-800/60 border-b border-slate-700/50 shrink-0">
            <button onClick={() => setActivePanel('bi')}
              className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activePanel === 'bi' ? 'text-blue-400 border-blue-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'
              }`}>
              📊 BI 数据
            </button>
            <button onClick={() => setActivePanel('ads')}
              className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 ${
                activePanel === 'ads' ? 'text-emerald-400 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'
              }`}>
              📢 广告操作
            </button>
          </div>

          {/* iframe */}
          <div className="flex-1 relative">
            <iframe
              src={METABASE_URL}
              className={`absolute inset-0 w-full h-full border-0 ${activePanel === 'bi' ? '' : 'hidden'}`}
              title="Metabase BI"
            />
            <iframe
              src={TOPTOU_URL}
              className={`absolute inset-0 w-full h-full border-0 ${activePanel === 'ads' ? '' : 'hidden'}`}
              title="TopTou Ads"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
