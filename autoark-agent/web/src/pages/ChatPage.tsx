import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, get } from '../api'
import ActionCard from '../components/ActionCard'

interface Message { role: 'user' | 'agent'; content: string; toolCalls?: any[]; actionIds?: string[] }

const TOPTOU_URL = 'https://toptou.tec-do.com/'
type Panel = 'dashboard' | 'ads'

function today() { return new Date().toISOString().slice(0, 10) }

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showTools, setShowTools] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<Panel>('dashboard')
  const [agentStatus, setAgentStatus] = useState<any>(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [lessons, setLessons] = useState<any[]>([])
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])
  useEffect(() => {
    get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})
    get('/api/pipeline/status').then(setAgentStatus).catch(() => {})
    get('/api/pipeline/history?limit=10').then(setHistory).catch(() => {})
    get('/api/pipeline/lessons').then(setLessons).catch(() => {})
  }, [])

  const triggerBrain = async () => {
    setPipelineRunning(true)
    try {
      const res = await post('/api/pipeline/run', {})
      setAgentStatus(null)
      get('/api/pipeline/status').then(setAgentStatus).catch(() => {})
      get('/api/pipeline/history?limit=10').then(setHistory).catch(() => {})
      get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})
    } catch (e: any) { console.error(e) }
    setPipelineRunning(false)
  }

  const send = async () => {
    if (!input.trim() || loading) return
    const msg = input.trim(); setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setLoading(true)
    try {
      const data = await post('/api/chat/send', { conversationId, message: msg })
      if (data.conversationId) setConversationId(data.conversationId)
      setMessages(prev => [...prev, { role: 'agent', content: data.agentResponse || 'No response', toolCalls: data.toolCalls, actionIds: data.actionIds }])
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'agent', content: `Error: ${e.message}` }])
    }
    setLoading(false)
  }

  const quickActions = [
    { label: '分析广告表现', msg: '帮我分析一下最近的广告表现' },
    { label: '查看 Agent 状态', msg: 'Agent 最近做了什么决策？效果如何？' },
    { label: '优化建议', msg: '根据数据给出优化建议' },
  ]

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-wide text-blue-400">AutoArk Agent</span>
          {agentStatus && (
            <span className="text-[10px] text-slate-500">
              {agentStatus.lastRun ? `上次: ${new Date(agentStatus.lastRun).toLocaleTimeString()}` : '未运行'}
              {agentStatus.reflectionAccuracy > 0 && ` | 准确率: ${agentStatus.reflectionAccuracy}%`}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full">{pendingCount} 待审批</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={triggerBrain} disabled={pipelineRunning}
            className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-40">
            {pipelineRunning ? '思考中...' : '立即决策'}
          </button>
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
                <div className="text-4xl mb-3 opacity-60">🧠</div>
                <h2 className="text-base font-semibold text-slate-300 mb-1">AI 投手 Agent</h2>
                <p className="text-xs text-slate-500 mb-3">自主感知 / 自主决策 / 自主反思 / 持续进化</p>
                {agentStatus?.focus?.length > 0 && (
                  <div className="w-full max-w-xs mb-4 px-3 py-2 bg-slate-800 rounded-lg border border-slate-700">
                    <div className="text-[10px] text-slate-400 mb-1">当前关注</div>
                    {agentStatus.focus.map((f: string, i: number) => (
                      <div key={i} className="text-[10px] text-slate-300">{f}</div>
                    ))}
                  </div>
                )}
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
                <div className={`max-w-[90%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 border border-slate-700 text-slate-200'}`}>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  {m.actionIds && m.actionIds.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {m.actionIds.map(id => <ActionCard key={id} actionId={id} onUpdate={() => get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})} />)}
                    </div>
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mt-1.5 border-t border-slate-600/30 pt-1.5">
                      <button onClick={() => setShowTools(showTools === `${i}` ? null : `${i}`)} className="text-[10px] text-slate-500 hover:text-slate-300">
                        {showTools === `${i}` ? '▼' : '▶'} {m.toolCalls.length} 工具
                      </button>
                      {showTools === `${i}` && m.toolCalls.map((tc: any, j: number) => (
                        <div key={j} className="text-[10px] bg-slate-900/50 rounded p-1.5 mt-1"><span className="font-mono text-blue-400">{tc.name}</span></div>
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
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                placeholder="跟 Agent 说..." disabled={loading}
                className="flex-1 px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500 disabled:opacity-40" />
              <button onClick={send} disabled={loading || !input.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-40">发送</button>
            </div>
          </div>
        </div>

        {/* ========== 右侧 ========== */}
        <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
          <div className="flex items-center bg-slate-800/60 border-b border-slate-700/50 shrink-0">
            <button onClick={() => setActivePanel('dashboard')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activePanel === 'dashboard' ? 'text-blue-400 border-blue-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'}`}>
              🧠 Agent 看板
            </button>
            <button onClick={() => setActivePanel('ads')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activePanel === 'ads' ? 'text-emerald-400 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'}`}>
              📢 广告操作
            </button>
          </div>

          {activePanel === 'dashboard' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Agent 状态卡片 */}
              {agentStatus && (
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                    <div className="text-[10px] text-slate-400">上次运行</div>
                    <div className="text-sm text-white font-medium">{agentStatus.lastRun ? new Date(agentStatus.lastRun).toLocaleTimeString() : '-'}</div>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                    <div className="text-[10px] text-slate-400">状态</div>
                    <div className={`text-sm font-medium ${agentStatus.lastStatus === 'completed' ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {agentStatus.lastStatus || '-'}
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                    <div className="text-[10px] text-slate-400">决策准确率(7d)</div>
                    <div className={`text-sm font-medium ${agentStatus.reflectionAccuracy >= 80 ? 'text-emerald-400' : agentStatus.reflectionAccuracy >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                      {agentStatus.reflectionAccuracy || 0}%
                    </div>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 border border-slate-700">
                    <div className="text-[10px] text-slate-400">7d 总决策</div>
                    <div className="text-sm text-white font-medium">{agentStatus.totalDecisions7d || 0}</div>
                  </div>
                </div>
              )}

              {/* 最近运行历史 */}
              <div className="bg-slate-800 rounded-lg border border-slate-700">
                <div className="px-3 py-2 border-b border-slate-700 text-xs font-medium text-slate-300">决策历史</div>
                <div className="divide-y divide-slate-700/50 max-h-60 overflow-y-auto">
                  {history.length === 0 && <div className="p-3 text-xs text-slate-500 text-center">暂无记录</div>}
                  {history.map((h: any, i: number) => (
                    <div key={i} className="px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400">{new Date(h.runAt).toLocaleString()}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                          {h.status}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 mt-0.5">{h.summary || '-'}</div>
                      {h.actions?.length > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {h.actions.filter((a: any) => a.executed).length} 自动执行 | {h.actions.filter((a: any) => !a.executed).length} 待审批
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 经验教训 */}
              {lessons.length > 0 && (
                <div className="bg-slate-800 rounded-lg border border-slate-700">
                  <div className="px-3 py-2 border-b border-slate-700 text-xs font-medium text-slate-300">Agent 学到的经验</div>
                  <div className="divide-y divide-slate-700/50 max-h-40 overflow-y-auto">
                    {lessons.map((l: any, i: number) => (
                      <div key={i} className="px-3 py-2">
                        <div className="text-[11px] text-slate-300">{l.content}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          置信度: {(l.confidence * 100).toFixed(0)}% | 验证: {l.validations}次
                          {l.tags?.length > 0 && ` | ${l.tags.join(', ')}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
