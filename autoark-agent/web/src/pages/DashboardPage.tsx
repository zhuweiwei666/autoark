import { useState, useEffect } from 'react'
import { get } from '../api'
import PixelAgent, { AGENTS, AgentType, AgentMood } from '../components/PixelAgent'

export default function DashboardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [expandedCycle, setExpandedCycle] = useState<string | null>(null)

  const load = async () => {
    try {
      const d = await get('/api/pipeline/dashboard')
      setData(d)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400">Loading...</div>
  if (!data) return <div className="flex items-center justify-center h-screen bg-slate-900 text-red-400">Failed to load dashboard</div>

  const agents = data.agents || {}
  const cycles = data.recentCycles || []
  const skills = data.skillStats || []

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            AutoArk Agent Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            最近更新: {data.lastCycleAt ? new Date(data.lastCycleAt).toLocaleString('zh-CN') : '无'}
          </p>
        </div>
        <a href="/agent/" className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700">
          返回聊天
        </a>
      </div>

      {/* Pipeline Status Bar */}
      <StatusBar summary={data.lastCycleSummary} />

      {/* Agent Team */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <AgentCard type="monitor" data={agents.monitor} />
        <AgentCard type="screener" data={agents.screener} />
        <AgentCard type="decision" data={agents.decision} />
        <AgentCard type="executor" data={agents.executor} />
        <AgentCard type="auditor" data={agents.auditor} />
        <AgentCard type="librarian" data={agents.librarian} />
      </div>

      {/* Pipeline Timeline + Skill Heatmap */}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <SectionTitle>Pipeline 时间线</SectionTitle>
          <div className="space-y-2">
            {cycles.map((c: any) => (
              <CycleRow key={c.id} cycle={c} expanded={expandedCycle === c.id} onToggle={() => setExpandedCycle(expandedCycle === c.id ? null : c.id)} />
            ))}
            {cycles.length === 0 && <div className="text-xs text-slate-500 text-center py-8">暂无运行记录</div>}
          </div>
        </div>
        <div>
          <SectionTitle>Skill 命中热力图</SectionTitle>
          <SkillHeatmap skills={skills} />
        </div>
      </div>
    </div>
  )
}

function StatusBar({ summary }: { summary: string }) {
  return (
    <div className="mb-6 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs text-slate-300">{summary}</span>
      </div>
    </div>
  )
}

function getMood(type: AgentType, data: any): AgentMood {
  if (!data || data.status === 'idle') return 'idle'
  if (type === 'screener' && data.needsDecision > 0) return 'working'
  if (type === 'decision' && data.actionsCount > 0) return 'thinking'
  if (type === 'executor' && data.executed > 0) return 'happy'
  if (type === 'executor' && data.failed > 0) return 'alert'
  if (type === 'auditor' && data.findings > 0) return 'alert'
  if (type === 'auditor' && data.accuracy > 80) return 'happy'
  if (data.status === 'online' || data.status === 'active') return 'working'
  return 'idle'
}

function AgentCard({ type, data }: { type: AgentType; data: any }) {
  const agent = AGENTS[type]
  const mood = getMood(type, data)
  const d = data || {}

  const stats = getAgentStats(type, d)

  return (
    <div className="rounded-xl bg-slate-800/80 border border-slate-700/50 p-3 backdrop-blur hover:border-slate-600/80 transition-colors">
      <div className="flex items-start gap-3">
        <PixelAgent type={type} mood={mood} size={52} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-200">{agent.label}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{
              background: `${agent.color}20`, color: agent.color,
            }}>
              {agent.role}
            </span>
          </div>
          <div className="mt-1.5 space-y-1">
            {stats.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[9px] text-slate-500">{s.label}</span>
                <span className={`text-[10px] font-mono ${s.highlight ? 'text-amber-400' : 'text-slate-300'}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function getAgentStats(type: AgentType, d: any): Array<{ label: string; value: string; highlight?: boolean }> {
  switch (type) {
    case 'monitor':
      return [
        { label: '扫描 Campaigns', value: String(d.campaignCount || 0) },
        { label: '总花费', value: `$${d.spend || 0}` },
        { label: 'ROAS', value: String(d.roas || '-') },
      ]
    case 'screener':
      return [
        { label: '需决策', value: String(d.needsDecision || 0), highlight: (d.needsDecision || 0) > 0 },
        { label: '观察中', value: String(d.watch || 0) },
        { label: '跳过', value: String(d.skip || 0) },
      ]
    case 'decision':
      return [
        { label: '操作数', value: String(d.actionsCount || 0) },
        { label: '已执行', value: String(d.autoExecuted || 0) },
        { label: '待审批', value: String(d.pending || 0), highlight: (d.pending || 0) > 0 },
      ]
    case 'executor':
      return [
        { label: '已执行', value: String(d.executed || 0) },
        { label: '失败', value: String(d.failed || 0), highlight: (d.failed || 0) > 0 },
      ]
    case 'auditor':
      return [
        { label: '准确率', value: `${d.accuracy || 0}%` },
        { label: '发现问题', value: String(d.findings || 0), highlight: (d.findings || 0) > 0 },
        { label: '正确/错误', value: `${d.correct || 0}/${d.wrong || 0}` },
      ]
    case 'librarian':
      return [
        { label: '知识库', value: `${d.knowledgeCount || 0} 条` },
        { label: '今日新增', value: String(d.knowledgeNewToday || 0) },
        { label: '管理 Skills', value: `${d.skillsManaged || 0} 个` },
      ]
    default:
      return []
  }
}

function CycleRow({ cycle, expanded, onToggle }: { cycle: any; expanded: boolean; onToggle: () => void }) {
  const time = new Date(cycle.runAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  const duration = cycle.duration ? `${(cycle.duration / 1000).toFixed(1)}s` : '-'
  const actions = cycle.actions || []
  const cls = cycle.classification || {}

  const phases = [
    { name: 'Monitor', icon: '🔭', done: true },
    { name: 'Screen', icon: '🛡️', done: true },
    { name: 'Classify', icon: '🏷️', done: true },
    { name: 'Decision', icon: '🧠', done: true },
    { name: 'Execute', icon: '⚡', done: actions.length > 0 },
    { name: 'Feishu', icon: '💬', done: true },
    { name: 'Audit', icon: '⚖️', done: true },
  ]

  return (
    <div className="rounded-lg bg-slate-800/60 border border-slate-700/40 overflow-hidden">
      <button onClick={onToggle} className="w-full px-3 py-2 flex items-center gap-3 hover:bg-slate-700/30 transition-colors">
        <span className="text-[10px] text-slate-400 font-mono w-12">{time}</span>

        {/* Phase 节点 */}
        <div className="flex items-center gap-0.5 flex-1">
          {phases.map((p, i) => (
            <div key={i} className="flex items-center">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] ${p.done ? 'bg-emerald-500/20' : 'bg-slate-700/50'}`}
                title={p.name}>
                {p.icon}
              </div>
              {i < phases.length - 1 && (
                <div className={`w-3 h-0.5 ${p.done ? 'bg-emerald-500/30' : 'bg-slate-700/30'}`} />
              )}
            </div>
          ))}
        </div>

        <span className="text-[9px] text-slate-500">{duration}</span>
        {actions.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">{actions.length} actions</span>
        )}
        <span className="text-[10px] text-slate-600">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-700/30">
          <div className="mt-2 text-[10px] text-slate-400 leading-relaxed">{cycle.summary}</div>
          {/* 分类统计 */}
          {Object.keys(cls).length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {Object.entries(cls).filter(([, v]) => (v as number) > 0).map(([k, v]) => (
                <span key={k} className={`text-[9px] px-1.5 py-0.5 rounded ${k.includes('loss') ? 'bg-red-500/15 text-red-400' : k.includes('high') ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
                  {k.replace(/_/g, ' ')} {String(v)}
                </span>
              ))}
            </div>
          )}
          {/* Actions */}
          {actions.length > 0 && (
            <div className="mt-2 space-y-1">
              {actions.map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-[9px]">
                  <span className={`px-1 py-0.5 rounded ${a.type === 'pause' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                    {a.type}
                  </span>
                  <span className="text-slate-300 truncate flex-1">{a.campaign}</span>
                  {a.auto && <span className="text-emerald-400">auto</span>}
                  {a.executed && <span className="text-emerald-400">done</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SkillHeatmap({ skills }: { skills: any[] }) {
  const maxTriggered = Math.max(...skills.map(s => s.triggered || 0), 1)
  const screener = skills.filter(s => s.agentId === 'screener')
  const decision = skills.filter(s => s.agentId === 'decision')

  return (
    <div className="space-y-3">
      <SkillGroup title="Screener Skills" skills={screener} max={maxTriggered} color="#3b82f6" />
      <SkillGroup title="Decision Skills" skills={decision} max={maxTriggered} color="#8b5cf6" />
    </div>
  )
}

function SkillGroup({ title, skills, max, color }: { title: string; skills: any[]; max: number; color: string }) {
  return (
    <div>
      <div className="text-[9px] text-slate-500 font-medium mb-1.5">{title}</div>
      <div className="space-y-1">
        {skills.map((s, i) => {
          const pct = max > 0 ? (s.triggered / max) * 100 : 0
          return (
            <div key={i} className="group">
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-[9px] ${s.enabled ? 'text-slate-300' : 'text-slate-600 line-through'}`}>{s.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] text-slate-500">{s.triggered}</span>
                  {(s.correct + s.wrong) > 0 && (
                    <span className={`text-[8px] ${s.accuracy >= 70 ? 'text-emerald-400' : s.accuracy >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                      {s.accuracy}%
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1 rounded-full bg-slate-700/50 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `${color}80` }} />
              </div>
            </div>
          )
        })}
        {skills.length === 0 && <div className="text-[9px] text-slate-600">无 Skill</div>}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-slate-400 mb-2">{children}</h2>
}
