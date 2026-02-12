import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, get } from '../api'
import ActionCard from '../components/ActionCard'

interface Message { role: 'user' | 'agent'; content: string; toolCalls?: any[]; actionIds?: string[] }
const TOPTOU_URL = 'https://toptou.tec-do.com/'
type Panel = 'agents' | 'ads'

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showTools, setShowTools] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<Panel>('agents')
  const [status, setStatus] = useState<any>(null)
  const [history, setHistory] = useState<any[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [lessons, setLessons] = useState<any[]>([])
  const [reflectionStats, setReflectionStats] = useState<any>(null)
  const [scope, setScope] = useState<any>(null)
  const [brainRunning, setBrainRunning] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<string | null>('monitor')
  const [showScopeEdit, setShowScopeEdit] = useState(false)
  const [scopeEdit, setScopeEdit] = useState({ accounts: '', packages: '', optimizers: '' })
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const refresh = () => {
    get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})
    get('/api/pipeline/status').then(setStatus).catch(() => {})
    get('/api/pipeline/history?limit=5').then(setHistory).catch(() => {})
    get('/api/actions/pending').then(setPending).catch(() => {})
    get('/api/pipeline/lessons').then(setLessons).catch(() => {})
    get('/api/pipeline/reflection-stats?days=7').then(setReflectionStats).catch(() => {})
    get('/api/pipeline/scope').then(d => {
      setScope(d?.scope)
      if (d?.scope) setScopeEdit({
        accounts: (d.scope.accountIds || []).join('\n'),
        packages: (d.scope.packageNames || []).join('\n'),
        optimizers: (d.scope.optimizers || []).join('\n'),
      })
    }).catch(() => {})
  }
  useEffect(refresh, [])

  const triggerBrain = async () => { setBrainRunning(true); try { await post('/api/pipeline/run', {}) } catch{}; refresh(); setBrainRunning(false) }
  const send = async () => {
    if (!input.trim() || loading) return
    const msg = input.trim(); setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }]); setLoading(true)
    try {
      const d = await post('/api/chat/send', { conversationId, message: msg })
      if (d.conversationId) setConversationId(d.conversationId)
      setMessages(prev => [...prev, { role: 'agent', content: d.agentResponse || 'No response', toolCalls: d.toolCalls, actionIds: d.actionIds }])
    } catch (e: any) { setMessages(prev => [...prev, { role: 'agent', content: `Error: ${e.message}` }]) }
    setLoading(false); refresh()
  }
  const approve = async (id: string) => { await post(`/api/actions/${id}/approve`, {}); refresh() }
  const reject = async (id: string) => { await post(`/api/actions/${id}/reject`, { reason: 'rejected' }); refresh() }
  const approveAll = async () => { if (!pending.length) return; await post('/api/actions/approve-all', { actionIds: pending.map((a: any) => a._id) }); refresh() }
  const saveScope = async () => {
    await post('/api/pipeline/scope', {
      accountIds: scopeEdit.accounts.split('\n').map(s=>s.trim()).filter(Boolean),
      packageNames: scopeEdit.packages.split('\n').map(s=>s.trim()).filter(Boolean),
      optimizers: scopeEdit.optimizers.split('\n').map(s=>s.trim()).filter(Boolean),
    }); refresh(); setShowScopeEdit(false)
  }

  const ago = (d: string) => {
    if (!d) return '从未'
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000)
    return m < 1 ? '刚刚' : m < 60 ? `${m}分钟前` : m < 1440 ? `${Math.round(m/60)}小时前` : `${Math.round(m/1440)}天前`
  }
  const typeLabel = (t: string) => ({ pause:'暂停', adjust_budget:'调预算', resume:'恢复' }[t] || t)

  const latestSnap = history[0]
  const classif = latestSnap?.classification || {}

  // 四个 Agent 卡片数据
  const agents = [
    {
      id: 'monitor', name: '监控 Agent', icon: '👁', role: '持续感知广告数据变化，检测异常事件',
      status: status?.lastStatus === 'completed' ? 'online' : status?.lastStatus || 'idle',
      lastRun: status?.lastRun,
      logs: [
        latestSnap ? `扫描了 ${latestSnap.totalCampaigns || '?'} 个广告系列` : null,
        latestSnap ? `今日总花费 $${latestSnap.totalSpend || 0}，整体 ROAS ${latestSnap.overallRoas || 0}` : null,
        classif.loss_severe ? `发现 ${classif.loss_severe} 个严重亏损` : null,
        classif.loss_mild ? `发现 ${classif.loss_mild} 个轻微亏损` : null,
        classif.high_potential ? `发现 ${classif.high_potential} 个高潜力` : null,
        `${classif.observing || 0} 个在观察期，${classif.stable_normal || 0} 个表现稳定`,
      ].filter(Boolean) as string[],
    },
    {
      id: 'strategy', name: '策略 Agent', icon: '🎯', role: '根据 Skill 和数据分析，生成操作建议',
      status: pending.length > 0 ? 'has_suggestions' : 'idle',
      logs: [
        pending.length > 0 ? `生成了 ${pending.length} 条操作建议，等待审批` : '暂无新建议',
        ...pending.slice(0, 3).map((a: any) => `→ ${typeLabel(a.type)} ${a.entityName?.substring(0, 30) || a.entityId}: ${a.reason?.replace(/^\[.*?\]\s*/, '').substring(0, 40)}`),
        pending.length > 3 ? `...还有 ${pending.length - 3} 条` : null,
      ].filter(Boolean) as string[],
    },
    {
      id: 'executor', name: '执行 Agent', icon: '⚡', role: '执行已审批的操作（调用 TopTou API）',
      status: 'standby',
      logs: [
        '等待审批通过后执行操作',
        scope?.accountIds?.length ? `权责范围: ${scope.accountIds.length} 个账户` : null,
        scope?.optimizers?.length ? `负责优化师: ${scope.optimizers.join(', ')}` : null,
        !scope?.accountIds?.length && !scope?.optimizers?.length ? '⚠ 未配置权责范围，不会执行任何操作' : null,
      ].filter(Boolean) as string[],
    },
    {
      id: 'auditor', name: '审计 Agent', icon: '📊', role: '回顾决策效果，积累经验，持续进化',
      status: reflectionStats?.total > 0 ? 'active' : 'idle',
      logs: [
        reflectionStats?.total > 0
          ? `7天决策: ${reflectionStats.total} 个 | 正确 ${reflectionStats.correct} | 错误 ${reflectionStats.wrong} | 准确率 ${reflectionStats.accuracy}%`
          : '暂无反思数据（需要先执行一些操作）',
        ...lessons.slice(0, 3).map((l: any) => `学到: ${l.content?.substring(0, 50)}`),
      ].filter(Boolean) as string[],
    },
  ]

  const statusColors: Record<string, string> = {
    online: 'bg-emerald-500', has_suggestions: 'bg-amber-500', active: 'bg-blue-500',
    standby: 'bg-slate-500', idle: 'bg-slate-600', running: 'bg-blue-500',
  }
  const statusLabels: Record<string, string> = {
    online: '运行中', has_suggestions: '有建议', active: '活跃', standby: '待命', idle: '空闲', running: '运行中',
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      <header className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-blue-400">AutoArk Agent</span>
          {pendingCount > 0 && <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full animate-pulse">{pendingCount} 待审批</span>}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={triggerBrain} disabled={brainRunning}
            className="text-xs text-emerald-400 hover:text-emerald-300 px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40">
            {brainRunning ? '思考中...' : '立即巡检'}
          </button>
          <button onClick={() => { setMessages([]); setConversationId(null) }} className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded">新对话</button>
          <button onClick={() => { localStorage.removeItem('token'); navigate('/login') }} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded">退出</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 左：对话 */}
        <div className="w-[36%] min-w-[320px] flex flex-col border-r border-slate-700/50">
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-3xl mb-2 opacity-50">🧠</div>
                <h2 className="text-sm font-semibold text-slate-300 mb-1">跟 Agent 对话</h2>
                <p className="text-[11px] text-slate-500 mb-4">问它数据、让它分析、查看状态</p>
                {[
                  { l: '分析广告', m: '分析最近的广告表现' },
                  { l: 'Agent 状态', m: 'Agent 最近做了什么？效果怎样？' },
                  { l: '优化建议', m: '给我一些优化建议' },
                ].map((q, i) => (
                  <button key={i} onClick={() => setInput(q.m)}
                    className="w-full max-w-xs mb-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 text-left">{q.l}</button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-blue-600' : 'bg-slate-800 border border-slate-700'}`}>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  {m.actionIds?.map(id => <ActionCard key={id} actionId={id} onUpdate={refresh} />)}
                  {m.toolCalls?.length > 0 && <button onClick={() => setShowTools(showTools===`${i}`?null:`${i}`)} className="text-[10px] text-slate-500 mt-1">{showTools===`${i}`?'▼':'▶'} {m.toolCalls.length} 工具</button>}
                  {showTools===`${i}` && m.toolCalls?.map((tc:any,j:number) => <div key={j} className="text-[10px] bg-slate-900/50 rounded p-1 mt-0.5"><span className="font-mono text-blue-400">{tc.name}</span></div>)}
                </div>
              </div>
            ))}
            {loading && <div className="flex justify-start"><div className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2"><div className="flex gap-1"><div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"/><div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}}/><div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}}/></div></div></div>}
            <div ref={endRef} />
          </div>
          <div className="border-t border-slate-700/50 p-3 bg-slate-800/50">
            <div className="flex gap-2">
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&send()} placeholder="跟 Agent 说..." disabled={loading}
                className="flex-1 px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500 disabled:opacity-40"/>
              <button onClick={send} disabled={loading||!input.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg disabled:opacity-40">发送</button>
            </div>
          </div>
        </div>

        {/* 右 */}
        <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
          <div className="flex items-center bg-slate-800/60 border-b border-slate-700/50 shrink-0">
            <button onClick={()=>setActivePanel('agents')} className={`px-4 py-2 text-xs font-medium border-b-2 ${activePanel==='agents'?'text-blue-400 border-blue-400 bg-slate-800/80':'text-slate-400 hover:text-white border-transparent'}`}>🧠 Agent 团队</button>
            <button onClick={()=>setActivePanel('ads')} className={`px-4 py-2 text-xs font-medium border-b-2 ${activePanel==='ads'?'text-emerald-400 border-emerald-400 bg-slate-800/80':'text-slate-400 hover:text-white border-transparent'}`}>📢 广告操作</button>
          </div>

          {activePanel === 'agents' && (
            <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 p-3 overflow-hidden">
              {agents.map(agent => (
                <div key={agent.id} className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden min-h-0">
                  {/* 卡片头 - 固定 */}
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{agent.icon}</span>
                      <div>
                        <div className="text-[11px] font-medium text-slate-200">{agent.name}</div>
                        <div className="text-[9px] text-slate-500">{agent.role}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {agent.id === 'monitor' && agent.lastRun && <span className="text-[9px] text-slate-500">{ago(agent.lastRun)}</span>}
                      <div className={`w-1.5 h-1.5 rounded-full ${statusColors[agent.status] || 'bg-slate-600'}`} />
                      <span className="text-[9px] text-slate-400">{statusLabels[agent.status] || agent.status}</span>
                    </div>
                  </div>

                  {/* 卡片体 - 滚动 */}
                  <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
                    {/* 日志 */}
                    <div className="space-y-1">
                      {agent.logs.map((log, i) => (
                        <div key={i} className={`text-[10px] leading-relaxed ${log.startsWith('⚠') ? 'text-amber-400' : log.startsWith('→') ? 'text-slate-400' : log.startsWith('学到') ? 'text-blue-300' : 'text-slate-300'}`}>
                          {!log.startsWith('→') && !log.startsWith('⚠') && !log.startsWith('学到') && <span className="text-slate-600 mr-1">•</span>}
                          {log}
                        </div>
                      ))}
                    </div>

                    {/* 策略 Agent: 内嵌审批 */}
                    {agent.id === 'strategy' && pending.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-700/30">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] text-amber-400 font-medium">待审批 ({pending.length})</span>
                          <button onClick={approveAll} className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30">全部批准</button>
                        </div>
                        {pending.slice(0, 20).map((a: any) => (
                          <div key={a._id} className="flex items-center gap-1.5 py-1 border-b border-slate-700/20 last:border-0">
                            <span className={`text-[8px] px-1 py-0.5 rounded shrink-0 ${a.type === 'pause' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                              {typeLabel(a.type)}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[9px] text-slate-300 truncate">{a.entityName || a.entityId}</div>
                            </div>
                            <div className="flex gap-0.5 shrink-0">
                              <button onClick={() => approve(a._id)} className="px-1.5 py-0.5 text-[8px] bg-emerald-500/20 text-emerald-400 rounded">✓</button>
                              <button onClick={() => reject(a._id)} className="px-1.5 py-0.5 text-[8px] bg-slate-700 text-slate-400 rounded">✗</button>
                            </div>
                          </div>
                        ))}
                        {pending.length > 20 && <div className="text-[9px] text-slate-500 text-center mt-1">+{pending.length - 20} 条</div>}
                      </div>
                    )}

                    {/* 执行 Agent: 权责配置 */}
                    {agent.id === 'executor' && (
                      <div className="mt-2 pt-2 border-t border-slate-700/30">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-slate-400">权责范围</span>
                          <button onClick={() => setShowScopeEdit(!showScopeEdit)} className="text-[9px] px-1.5 py-0.5 bg-slate-700 text-slate-300 rounded hover:bg-slate-600">
                            {showScopeEdit ? '取消' : '编辑'}
                          </button>
                        </div>
                        {!showScopeEdit ? (
                          <div className="text-[9px] text-slate-400 space-y-0.5">
                            <div>账户: {scope?.accountIds?.length ? <span className="text-slate-300">{scope.accountIds.join(', ')}</span> : <span className="text-slate-600">未限制</span>}</div>
                            <div>产品: {scope?.packageNames?.length ? <span className="text-slate-300">{scope.packageNames.join(', ')}</span> : <span className="text-slate-600">未限制</span>}</div>
                            <div>优化师: {scope?.optimizers?.length ? <span className="text-slate-300">{scope.optimizers.join(', ')}</span> : <span className="text-slate-600">未限制</span>}</div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {[['账户ID','accounts','每行一个'],['包名','packages','com.app'],['优化师','optimizers','zhuweiwei']].map(([l,k,p]:any) => (
                              <div key={k}>
                                <label className="text-[8px] text-slate-500">{l}</label>
                                <textarea value={(scopeEdit as any)[k]} onChange={e=>setScopeEdit({...scopeEdit,[k]:e.target.value})} rows={2} placeholder={p}
                                  className="w-full px-1.5 py-0.5 bg-slate-700 border border-slate-600 rounded text-[9px] text-white placeholder-slate-500 outline-none focus:border-blue-500 resize-none"/>
                              </div>
                            ))}
                            <button onClick={saveScope} className="w-full py-1 text-[9px] bg-blue-600 text-white rounded">保存</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 审计 Agent: 经验列表 */}
                    {agent.id === 'auditor' && lessons.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-700/30">
                        <div className="text-[9px] text-slate-400 mb-1">积累的经验</div>
                        {lessons.map((l: any, i: number) => (
                          <div key={i} className="text-[9px] text-blue-300/80 py-0.5">
                            💡 {l.content?.substring(0, 80)} <span className="text-slate-600">({Math.round((l.confidence||0)*100)}%)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
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
