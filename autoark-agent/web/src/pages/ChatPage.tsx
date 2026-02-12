import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, get } from '../api'
import ActionCard from '../components/ActionCard'
import AgentCard from '../components/AgentCard'

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
  const [agentConfigs, setAgentConfigs] = useState<any>({})
  const [brainRunning, setBrainRunning] = useState(false)
  const [expandedAgent, setExpandedAgent] = useState<string | null>('monitor')
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
    get('/api/agent-config').then(setAgentConfigs).catch(() => {})
    get('/api/pipeline/scope').then(d => setScope(d?.scope)).catch(() => {})
  }
  useEffect(refresh, [])

  const triggerBrain = async () => {
    setBrainRunning(true)
    try { await post('/api/pipeline/run', {}) } catch {}
    refresh()
    get('/api/pipeline/latest').then(setLatestSnap).catch(() => {})
    setBrainRunning(false)
  }
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
  // approve/reject/saveScope 已移入 AgentCard 组件

  const ago = (d: string) => {
    if (!d) return '从未'
    const m = Math.round((Date.now() - new Date(d).getTime()) / 60000)
    return m < 1 ? '刚刚' : m < 60 ? `${m}分钟前` : m < 1440 ? `${Math.round(m/60)}小时前` : `${Math.round(m/1440)}天前`
  }
  const typeLabel = (t: string) => ({ pause:'暂停', adjust_budget:'调预算', resume:'恢复' }[t] || t)

  // 用 latest API 获取最新快照（比 history 更可靠）
  const [latestSnap, setLatestSnap] = useState<any>(null)
  useEffect(() => {
    // 轮询直到拿到 completed 状态的快照
    const load = () => get('/api/pipeline/latest').then(d => {
      setLatestSnap(d)
      if (d?.status === 'running') setTimeout(load, 5000) // 5 秒后重试
    }).catch(() => {})
    load()
  }, [])

  const classif = latestSnap?.classification || {}

  // 四个 Agent 卡片数据
  const agents = [
    {
      id: 'monitor', name: '监控 Agent', icon: '👁', role: '持续感知广告数据变化，检测异常事件',
      status: status?.lastStatus === 'completed' ? 'online' : status?.lastStatus || 'idle',
      lastRun: status?.lastRun,
      logs: [
        latestSnap?.totalCampaigns ? `扫描了 ${latestSnap.totalCampaigns} 个广告系列` : (status?.lastRun ? '数据加载中...' : '未运行'),
        latestSnap?.totalSpend ? `今日总花费 $${latestSnap.totalSpend}，整体 ROAS ${latestSnap.overallRoas || 0}` : null,
        classif.loss_severe ? `发现 ${classif.loss_severe} 个严重亏损` : null,
        classif.loss_mild ? `发现 ${classif.loss_mild} 个轻微亏损` : null,
        classif.high_potential ? `发现 ${classif.high_potential} 个高潜力` : null,
        (classif.observing || classif.stable_normal) ? `${classif.observing || 0} 个在观察期，${classif.stable_normal || 0} 个表现稳定` : null,
        latestSnap?.summary ? `最近: ${latestSnap.summary.substring(0, 80)}` : null,
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
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  config={agentConfigs[agent.id]}
                  pending={agent.id === 'strategy' ? pending : []}
                  lessons={agent.id === 'auditor' ? lessons : []}
                  skills={agentConfigs.strategy?.activeSkillIds || []}
                  onRefresh={refresh}
                />
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
