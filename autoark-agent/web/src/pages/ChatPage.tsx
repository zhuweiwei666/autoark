import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { post, get } from '../api'
import ActionCard from '../components/ActionCard'

interface Message { role: 'user' | 'agent'; content: string; toolCalls?: any[]; actionIds?: string[] }

const TOPTOU_URL = 'https://toptou.tec-do.com/'
type Panel = 'agent' | 'ads'

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [showTools, setShowTools] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<Panel>('agent')
  const [agentStatus, setAgentStatus] = useState<any>(null)
  const [pipelineRunning, setPipelineRunning] = useState(false)
  const [history, setHistory] = useState<any[]>([])
  const [pendingActions, setPendingActions] = useState<any[]>([])
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [scopeData, setScopeData] = useState<any>(null)
  const [showScopeEdit, setShowScopeEdit] = useState(false)
  const [scopeEdit, setScopeEdit] = useState({ accounts: '', packages: '', optimizers: '' })
  const endRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const refresh = () => {
    get('/api/monitor/pending-count').then(d => setPendingCount(d.count || 0)).catch(() => {})
    get('/api/pipeline/status').then(setAgentStatus).catch(() => {})
    get('/api/pipeline/history?limit=10').then(setHistory).catch(() => {})
    get('/api/actions/pending').then(setPendingActions).catch(() => {})
    get('/api/pipeline/scope').then(d => {
      setScopeData(d)
      if (d?.scope) setScopeEdit({
        accounts: (d.scope.accountIds || []).join('\n'),
        packages: (d.scope.packageNames || []).join('\n'),
        optimizers: (d.scope.optimizers || []).join('\n'),
      })
    }).catch(() => {})
  }
  useEffect(refresh, [])

  const triggerBrain = async () => {
    setPipelineRunning(true)
    try { await post('/api/pipeline/run', {}) } catch {}
    refresh()
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
    refresh()
  }

  const approveAction = async (id: string) => { await post(`/api/actions/${id}/approve`, {}); refresh() }
  const rejectAction = async (id: string) => { await post(`/api/actions/${id}/reject`, { reason: 'rejected' }); refresh() }
  const approveAll = async () => {
    if (!pendingActions.length) return
    await post('/api/actions/approve-all', { actionIds: pendingActions.map((a: any) => a._id) }); refresh()
  }
  const saveScope = async () => {
    await post('/api/pipeline/scope', {
      accountIds: scopeEdit.accounts.split('\n').map(s => s.trim()).filter(Boolean),
      packageNames: scopeEdit.packages.split('\n').map(s => s.trim()).filter(Boolean),
      optimizers: scopeEdit.optimizers.split('\n').map(s => s.trim()).filter(Boolean),
    })
    refresh(); setShowScopeEdit(false)
  }

  // 把数据格式化成人话
  const formatTimeSince = (dateStr: string) => {
    if (!dateStr) return '从未'
    const mins = Math.round((Date.now() - new Date(dateStr).getTime()) / 60000)
    if (mins < 1) return '刚刚'
    if (mins < 60) return `${mins} 分钟前`
    if (mins < 1440) return `${Math.round(mins / 60)} 小时前`
    return `${Math.round(mins / 1440)} 天前`
  }

  const actionTypeLabel = (type: string) => {
    const map: Record<string, string> = { pause: '暂停', adjust_budget: '调预算', resume: '恢复', create_campaign: '创建' }
    return map[type] || type
  }

  const quickActions = [
    { label: '分析广告表现', msg: '帮我分析一下最近的广告表现，哪些该调整？' },
    { label: '查看 Agent 状态', msg: 'Agent 最近做了什么？效果怎么样？' },
    { label: '优化建议', msg: '给我一些优化建议' },
  ]

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-blue-400">AutoArk Agent</span>
          <span className="text-[10px] text-slate-500">
            {agentStatus?.lastRun ? `巡检于 ${formatTimeSince(agentStatus.lastRun)}` : ''}
          </span>
          {pendingCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-[10px] font-medium rounded-full animate-pulse">
              {pendingCount} 条待你审批
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={triggerBrain} disabled={pipelineRunning}
            className="text-xs text-emerald-400 hover:text-emerald-300 px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors disabled:opacity-40">
            {pipelineRunning ? '思考中...' : '立即巡检'}
          </button>
          <button onClick={() => { setMessages([]); setConversationId(null) }}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded transition-colors">新对话</button>
          <button onClick={() => { localStorage.removeItem('token'); navigate('/login') }}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded transition-colors">退出</button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ========== 左侧：对话 ========== */}
        <div className="w-[38%] min-w-[340px] flex flex-col border-r border-slate-700/50">
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-4xl mb-3 opacity-50">🧠</div>
                <h2 className="text-base font-semibold text-slate-300 mb-1">AI 投手</h2>
                <p className="text-xs text-slate-500 mb-4">自主巡检广告数据 / 发现问题 / 提出建议 / 等你审批</p>
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
                <div className={`max-w-[90%] rounded-xl px-3 py-2 ${m.role === 'user' ? 'bg-blue-600' : 'bg-slate-800 border border-slate-700'}`}>
                  <div className="text-xs whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  {m.actionIds && m.actionIds.length > 0 && m.actionIds.map(id =>
                    <ActionCard key={id} actionId={id} onUpdate={refresh} />
                  )}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <button onClick={() => setShowTools(showTools === `${i}` ? null : `${i}`)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 mt-1">
                      {showTools === `${i}` ? '▼' : '▶'} {m.toolCalls.length} 工具调用
                    </button>
                  )}
                  {showTools === `${i}` && m.toolCalls?.map((tc: any, j: number) => (
                    <div key={j} className="text-[10px] bg-slate-900/50 rounded p-1 mt-1">
                      <span className="font-mono text-blue-400">{tc.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" />
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}} />
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}} />
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
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg disabled:opacity-40">发送</button>
            </div>
          </div>
        </div>

        {/* ========== 右侧 ========== */}
        <div className="flex-1 flex flex-col bg-slate-950 min-w-0">
          <div className="flex items-center bg-slate-800/60 border-b border-slate-700/50 shrink-0">
            <button onClick={() => setActivePanel('agent')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activePanel === 'agent' ? 'text-blue-400 border-blue-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'}`}>
              🧠 Agent 工作台
            </button>
            <button onClick={() => setActivePanel('ads')}
              className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${activePanel === 'ads' ? 'text-emerald-400 border-emerald-400 bg-slate-800/80' : 'text-slate-400 hover:text-white border-transparent'}`}>
              📢 广告操作
            </button>
          </div>

          {activePanel === 'agent' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* ======= 故事化状态摘要 ======= */}
              <div className="bg-gradient-to-r from-slate-800 to-slate-800/50 rounded-xl p-4 border border-slate-700">
                <div className="text-sm text-slate-200 leading-relaxed">
                  {agentStatus?.lastRun ? (
                    <>
                      Agent {formatTimeSince(agentStatus.lastRun)}巡检了广告数据，
                      状态 <span className={agentStatus.lastStatus === 'completed' ? 'text-emerald-400' : 'text-amber-400'}>{agentStatus.lastStatus === 'completed' ? '正常' : agentStatus.lastStatus}</span>。
                      {agentStatus.totalDecisions7d > 0 && (
                        <> 过去 7 天做了 <span className="text-blue-400">{agentStatus.totalDecisions7d}</span> 个决策
                        {agentStatus.reflectionAccuracy > 0 && <>，验证准确率 <span className={agentStatus.reflectionAccuracy >= 70 ? 'text-emerald-400' : 'text-amber-400'}>{agentStatus.reflectionAccuracy}%</span></>}。</>
                      )}
                      {pendingCount > 0 && <> 当前有 <span className="text-amber-400 font-medium">{pendingCount} 条建议</span>等你审批。</>}
                      {pendingCount === 0 && <> 当前没有需要你处理的事项。</>}
                    </>
                  ) : (
                    <>Agent 还没有运行过。点击上方「立即巡检」开始第一次分析。</>
                  )}
                </div>
                {agentStatus?.focus?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-700/50">
                    <div className="text-[10px] text-slate-500 mb-1">当前关注：</div>
                    {agentStatus.focus.map((f: string, i: number) => (
                      <div key={i} className="text-[11px] text-slate-400">• {f}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* ======= 待审批 ======= */}
              {pendingActions.length > 0 && (
                <div className="bg-slate-800 rounded-xl border border-amber-500/30">
                  <div className="px-4 py-2.5 border-b border-slate-700 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-amber-400">需要你审批的操作</span>
                      <span className="text-[10px] text-slate-500 ml-2">{pendingActions.length} 条</span>
                    </div>
                    <button onClick={approveAll}
                      className="text-[10px] px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30">全部批准</button>
                  </div>
                  <div className="divide-y divide-slate-700/30 max-h-80 overflow-y-auto">
                    {pendingActions.slice(0, 20).map((a: any) => (
                      <div key={a._id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                a.type === 'pause' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                              }`}>{actionTypeLabel(a.type)}</span>
                              {a.reason?.startsWith('[紧急]') && <span className="text-[10px] px-1 py-0.5 bg-red-500/30 text-red-300 rounded">紧急</span>}
                              {a.reason?.startsWith('[建议立即]') && <span className="text-[10px] px-1 py-0.5 bg-amber-500/20 text-amber-300 rounded">建议立即</span>}
                            </div>
                            <div className="text-[11px] text-slate-200 truncate">{a.entityName || a.entityId}</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">{a.reason?.replace(/^\[(紧急|高优|建议立即)\]\s*/, '')}</div>
                            {a.params?.currentBudget != null && a.params?.newBudget != null && (
                              <div className="text-[10px] text-slate-500 mt-0.5">预算: ${a.params.currentBudget} → <span className="text-blue-400">${a.params.newBudget}</span></div>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={() => approveAction(a._id)}
                              className="px-3 py-1 text-[10px] font-medium bg-emerald-500/20 text-emerald-400 rounded hover:bg-emerald-500/30">批准</button>
                            <button onClick={() => rejectAction(a._id)}
                              className="px-3 py-1 text-[10px] font-medium bg-slate-700 text-slate-400 rounded hover:bg-slate-600">拒绝</button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {pendingActions.length > 20 && (
                      <div className="px-4 py-2 text-[10px] text-slate-500 text-center">还有 {pendingActions.length - 20} 条...</div>
                    )}
                  </div>
                </div>
              )}

              {/* ======= 工作日志 ======= */}
              <div className="bg-slate-800 rounded-xl border border-slate-700">
                <div className="px-4 py-2.5 border-b border-slate-700">
                  <span className="text-xs font-medium text-slate-300">Agent 工作日志</span>
                </div>
                <div className="divide-y divide-slate-700/30 max-h-64 overflow-y-auto">
                  {history.length === 0 && <div className="p-4 text-xs text-slate-500 text-center">还没有工作记录</div>}
                  {history.map((h: any) => (
                    <div key={h._id} className="px-4 py-2.5 cursor-pointer hover:bg-slate-800/50" onClick={() => setExpandedRun(expandedRun === h._id ? null : h._id)}>
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] text-slate-300">
                          {formatTimeSince(h.runAt)} · 扫描 {h.totalCampaigns || '?'} 个广告 · ROAS {h.overallRoas || '-'}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {h.actions?.length > 0 && <span className="text-[10px] text-slate-500">{h.actions.length} 操作</span>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${h.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' : h.status === 'running' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                            {h.status === 'completed' ? '完成' : h.status === 'running' ? '运行中' : '失败'}
                          </span>
                        </div>
                      </div>
                      {/* 展开详情 */}
                      {expandedRun === h._id && (
                        <div className="mt-2 pt-2 border-t border-slate-700/30">
                          <div className="text-[11px] text-slate-400 mb-2">{h.summary}</div>
                          {h.actions?.slice(0, 15).map((a: any, j: number) => (
                            <div key={j} className="flex items-center gap-1.5 py-0.5 text-[10px]">
                              <span className={`px-1 py-0.5 rounded ${a.type === 'pause' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400'}`}>
                                {actionTypeLabel(a.type || '')}
                              </span>
                              <span className="text-slate-300 truncate flex-1">{a.campaignName || a.campaignId}</span>
                            </div>
                          ))}
                          {(h.actions?.length || 0) > 15 && <div className="text-[10px] text-slate-500 mt-1">...还有 {h.actions.length - 15} 个</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ======= 权责范围 ======= */}
              <div className="bg-slate-800 rounded-xl border border-slate-700">
                <div className="px-4 py-2.5 border-b border-slate-700 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-medium text-slate-300">Agent 能操作哪些广告</span>
                    <span className="text-[10px] text-slate-500 ml-2">范围外的只看不动</span>
                  </div>
                  <button onClick={() => setShowScopeEdit(!showScopeEdit)}
                    className="text-[10px] px-2 py-1 bg-slate-700 text-slate-300 rounded hover:bg-slate-600">{showScopeEdit ? '取消' : '编辑'}</button>
                </div>
                <div className="p-3">
                  {!showScopeEdit ? (
                    <div className="space-y-1">
                      {[
                        ['账户', scopeData?.scope?.accountIds],
                        ['产品', scopeData?.scope?.packageNames],
                        ['优化师', scopeData?.scope?.optimizers],
                      ].map(([label, items]: any) => (
                        <div key={label} className="text-[10px]">
                          <span className="text-slate-500">{label}: </span>
                          <span className="text-slate-300">{items?.length ? items.join(', ') : <span className="text-slate-600">未限制</span>}</span>
                        </div>
                      ))}
                      {!scopeData?.scope?.accountIds?.length && !scopeData?.scope?.packageNames?.length && !scopeData?.scope?.optimizers?.length && (
                        <div className="text-[10px] text-amber-400 mt-1">未配置范围 → Agent 不会生成任何操作建议。请点编辑配置。</div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {[
                        ['可操作账户 ID', 'accounts', '每行一个账户 ID'],
                        ['可操作产品/包名', 'packages', '如 com.app.name'],
                        ['可操作优化师', 'optimizers', '如 zhuweiwei'],
                      ].map(([label, key, ph]: any) => (
                        <div key={key}>
                          <label className="text-[10px] text-slate-400 block mb-0.5">{label}</label>
                          <textarea value={(scopeEdit as any)[key]} onChange={e => setScopeEdit({...scopeEdit, [key]: e.target.value})}
                            rows={2} placeholder={ph}
                            className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] text-white placeholder-slate-500 outline-none focus:border-blue-500 resize-none" />
                        </div>
                      ))}
                      <button onClick={saveScope} className="w-full py-1.5 text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded">保存</button>
                    </div>
                  )}
                </div>
              </div>
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
