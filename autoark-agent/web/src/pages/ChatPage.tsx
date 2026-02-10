import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, get } from '../api'
import ActionCard from '../components/ActionCard'

interface Message {
  role: 'user' | 'agent'
  content: string
  toolCalls?: any[]
  actionIds?: string[]
  timestamp?: string
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showTools, setShowTools] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => { get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)) }, [messages])

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
    { label: '检查今日数据', msg: '今天的广告花费和 ROAS 怎么样？' },
    { label: '优化建议', msg: '根据最近的数据，给我一些优化建议' },
  ]

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b shadow-sm">
        <h1 className="text-lg font-bold text-slate-800">AutoArk Agent</h1>
        <div className="flex items-center gap-3">
          {pendingCount > 0 && (
            <span className="px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
              {pendingCount} 待审批
            </span>
          )}
          <button onClick={() => navigate('/monitor')} className="text-sm text-slate-500 hover:text-slate-800">
            监控
          </button>
          <button onClick={() => { setMessages([]); setConversationId(null) }} className="text-sm text-slate-500 hover:text-slate-800">
            新对话
          </button>
          <button onClick={() => { localStorage.removeItem('token'); navigate('/login') }} className="text-sm text-red-400 hover:text-red-600">
            退出
          </button>
        </div>
      </header>

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-4xl mx-auto w-full">
        {messages.length === 0 && (
          <div className="text-center mt-20">
            <div className="text-5xl mb-4">🤖</div>
            <h2 className="text-xl font-semibold text-slate-700 mb-2">你的 AI 投手</h2>
            <p className="text-slate-400 mb-8">告诉我你想做什么，我来帮你分析和操作广告</p>
            <div className="flex gap-3 justify-center flex-wrap">
              {quickActions.map((q, i) => (
                <button key={i} onClick={() => setInput(q.msg)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-blue-300 hover:shadow transition-all">
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`mb-4 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
              m.role === 'user'
                ? 'bg-blue-500 text-white rounded-br-md'
                : 'bg-white border border-slate-200 rounded-bl-md shadow-sm'
            }`}>
              <div className="text-sm whitespace-pre-wrap">{m.content}</div>

              {/* 审批卡片 */}
              {m.actionIds?.length > 0 && (
                <div className="mt-3 space-y-2">
                  {m.actionIds.map(id => <ActionCard key={id} actionId={id} onUpdate={() => get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0))} />)}
                </div>
              )}

              {/* 工具调用详情 */}
              {m.toolCalls?.length > 0 && (
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <button onClick={() => setShowTools(showTools === `${i}` ? null : `${i}`)} className="text-xs text-slate-400 hover:text-slate-600">
                    {showTools === `${i}` ? '▼' : '▶'} {m.toolCalls.length} 个工具调用
                  </button>
                  {showTools === `${i}` && (
                    <div className="mt-1 space-y-1">
                      {m.toolCalls.map((tc, j) => (
                        <div key={j} className="text-xs bg-slate-50 rounded p-2">
                          <span className="font-mono text-blue-600">{tc.name}</span>
                          <pre className="text-[10px] text-slate-400 mt-1 overflow-x-auto">{JSON.stringify(tc.args, null, 2)}</pre>
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
          <div className="flex justify-start mb-4">
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 输入框 */}
      <div className="border-t bg-white px-4 py-3">
        <div className="max-w-4xl mx-auto flex gap-3">
          <input
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="跟 Agent 说..."
            disabled={loading}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:border-blue-400 disabled:opacity-50"
          />
          <button onClick={send} disabled={loading || !input.trim()}
            className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50">
            发送
          </button>
        </div>
      </div>
    </div>
  )
}
