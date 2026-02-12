import { useState, useEffect } from 'react'
import { post } from '../api'

interface Props {
  agent: { id: string; name: string; icon: string; role: string; status: string; logs: string[] }
  config: any
  pending?: any[]
  lessons?: any[]
  skills?: any[]
  onRefresh: () => void
}

const statusColors: Record<string, string> = { online:'bg-emerald-500', has_suggestions:'bg-amber-500', active:'bg-blue-500', standby:'bg-slate-500', idle:'bg-slate-600' }
const statusLabels: Record<string, string> = { online:'运行中', has_suggestions:'有建议', active:'活跃', standby:'待命', idle:'空闲' }
const permLabels: Record<string, string> = { pause_severe_loss:'暂停严重亏损', pause_mild_loss:'暂停轻微亏损', pause_zero_conversion:'暂停零转化', increase_budget:'加预算', decrease_budget:'减预算', resume:'恢复广告' }
const typeLabel = (t: string) => ({pause:'暂停',adjust_budget:'调预算',resume:'恢复'}[t]||t)

export default function AgentCard({ agent, config, pending=[], lessons=[], skills=[], onRefresh }: Props) {
  const [showConfig, setShowConfig] = useState(false)
  const [form, setForm] = useState<any>({})
  const [saving, setSaving] = useState(false)

  const cfg = config || {}

  // 把 config 加载到 form
  useEffect(() => {
    if (!config) return
    if (agent.id === 'monitor') {
      const m = cfg.monitor || {}
      setForm({
        scanInterval: m.scanIntervalMinutes || 10,
        spendSpikeRatio: m.eventThresholds?.spendSpikeRatio || 2,
        roasCrashPct: m.eventThresholds?.roasCrashDropPct || 50,
        zeroConvMinSpend: m.eventThresholds?.zeroConversionMinSpend || 50,
        dataSources: JSON.stringify(m.dataSources || [], null, 2),
      })
    }
    if (agent.id === 'strategy') {
      const s = cfg.strategy || {}
      setForm({
        targetRoas: s.objectives?.targetRoas || 1.5,
        maxCpa: s.objectives?.maxCpa || '',
        budgetLimit: s.objectives?.dailyBudgetLimit || '',
        lossSevereRoas: s.thresholds?.loss_severe_roas || 0.3,
        lossMildRoas: s.thresholds?.loss_mild_roas || 0.8,
        highPotentialRoas: s.thresholds?.high_potential_roas || 2.5,
        observeMaxSpend: s.thresholds?.observe_max_spend || 30,
        customRules: (s.customRules || []).join('\n'),
      })
    }
    if (agent.id === 'executor') {
      const e = cfg.executor || {}
      setForm({
        accountIds: (e.scope?.accountIds || []).join('\n'),
        packageNames: (e.scope?.packageNames || []).join('\n'),
        optimizers: (e.scope?.optimizers || []).join('\n'),
        ...Object.fromEntries(Object.entries(e.permissions || {}).map(([k,v]) => [`perm_${k}`, v])),
        maxBudgetPct: e.limits?.maxBudgetChangePct || 30,
        maxDailyBudget: e.limits?.maxDailyBudget || 500,
        cooldown: e.limits?.cooldownHours || 24,
        maxActions: e.limits?.maxActionsPerRun || 50,
      })
    }
    if (agent.id === 'auditor') {
      const a = cfg.auditor || {}
      setForm({
        reflectionDelay: a.reflectionDelayHours || 2,
        reflectionWindow: a.reflectionWindowHours || 24,
        evolutionEnabled: a.evolutionEnabled !== false,
        evolutionSchedule: a.evolutionSchedule || 'weekly',
        lessonRules: (a.lessonRules || []).join('\n'),
        pauseOnLow: a.workflowControl?.pauseOnLowAccuracy || false,
        pauseThreshold: a.workflowControl?.pauseAccuracyThreshold || 50,
        maxErrors: a.workflowControl?.maxConsecutiveErrors || 5,
      })
    }
  }, [config, agent.id])

  const save = async () => {
    setSaving(true)
    let body: any = {}
    if (agent.id === 'monitor') {
      let ds = []
      try { ds = JSON.parse(form.dataSources) } catch { ds = cfg.monitor?.dataSources || [] }
      body = { monitor: {
        dataSources: ds,
        scanIntervalMinutes: Number(form.scanInterval),
        eventThresholds: { spendSpikeRatio: Number(form.spendSpikeRatio), roasCrashDropPct: Number(form.roasCrashPct), zeroConversionMinSpend: Number(form.zeroConvMinSpend) },
      }}
    }
    if (agent.id === 'strategy') {
      body = { strategy: {
        objectives: { targetRoas: Number(form.targetRoas), maxCpa: form.maxCpa ? Number(form.maxCpa) : undefined, dailyBudgetLimit: form.budgetLimit ? Number(form.budgetLimit) : undefined },
        thresholds: { loss_severe_roas: Number(form.lossSevereRoas), loss_mild_roas: Number(form.lossMildRoas), high_potential_roas: Number(form.highPotentialRoas), observe_max_spend: Number(form.observeMaxSpend) },
        customRules: form.customRules.split('\n').filter(Boolean),
      }}
    }
    if (agent.id === 'executor') {
      const perms: any = {}
      Object.keys(form).filter(k => k.startsWith('perm_')).forEach(k => { perms[k.replace('perm_', '')] = form[k] })
      body = { executor: {
        scope: { accountIds: form.accountIds.split('\n').filter(Boolean), packageNames: form.packageNames.split('\n').filter(Boolean), optimizers: form.optimizers.split('\n').filter(Boolean) },
        permissions: perms,
        limits: { maxBudgetChangePct: Number(form.maxBudgetPct), maxDailyBudget: Number(form.maxDailyBudget), cooldownHours: Number(form.cooldown), maxActionsPerRun: Number(form.maxActions) },
      }}
    }
    if (agent.id === 'auditor') {
      body = { auditor: {
        reflectionDelayHours: Number(form.reflectionDelay),
        reflectionWindowHours: Number(form.reflectionWindow),
        evolutionEnabled: form.evolutionEnabled,
        evolutionSchedule: form.evolutionSchedule,
        lessonRules: form.lessonRules.split('\n').filter(Boolean),
        workflowControl: { pauseOnLowAccuracy: form.pauseOnLow, pauseAccuracyThreshold: Number(form.pauseThreshold), maxConsecutiveErrors: Number(form.maxErrors) },
      }}
    }
    try {
      await fetch(`/agent/api/agent-config/${agent.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(body),
      })
    } catch {}
    setSaving(false); onRefresh(); setShowConfig(false)
  }

  const approve = async (id: string) => { await post(`/api/actions/${id}/approve`, {}); onRefresh() }
  const reject = async (id: string) => { await post(`/api/actions/${id}/reject`, { reason: 'rejected' }); onRefresh() }
  const approveAll = async () => { await post('/api/actions/approve-all', { actionIds: pending.map((a:any) => a._id) }); onRefresh() }

  const F = (key: string, label: string, type='text', opts?: { suffix?: string; placeholder?: string }) => (
    <div className="flex items-center justify-between py-0.5">
      <label className="text-[9px] text-slate-400">{label}</label>
      <div className="flex items-center gap-0.5">
        <input value={form[key] ?? ''} onChange={e => setForm({...form, [key]: type==='number' ? e.target.value : e.target.value})}
          type={type} className="w-16 px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-[10px] text-white text-right outline-none focus:border-blue-500" placeholder={opts?.placeholder} />
        {opts?.suffix && <span className="text-[9px] text-slate-500">{opts.suffix}</span>}
      </div>
    </div>
  )

  const Toggle = (key: string, label: string) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[9px] text-slate-400">{label}</span>
      <button onClick={() => setForm({...form, [key]: !form[key]})}
        className={`text-[9px] px-2 py-0.5 rounded ${form[key] ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>
        {form[key] ? '开' : '关'}
      </button>
    </div>
  )

  const PermToggle = (key: string, label: string) => (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[9px] text-slate-300">{label}</span>
      <button onClick={() => setForm({...form, [`perm_${key}`]: form[`perm_${key}`]==='auto' ? 'approve' : 'auto'})}
        className={`text-[9px] px-2 py-0.5 rounded ${form[`perm_${key}`]==='auto' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
        {form[`perm_${key}`]==='auto' ? '自动' : '审批'}
      </button>
    </div>
  )

  const TA = (key: string, label: string, rows=3, placeholder='') => (
    <div>
      <label className="text-[9px] text-slate-500 block mb-0.5">{label}</label>
      <textarea value={form[key] ?? ''} onChange={e => setForm({...form, [key]: e.target.value})} rows={rows} placeholder={placeholder}
        className="w-full px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[9px] text-white placeholder-slate-500 outline-none focus:border-blue-500 resize-none font-mono" />
    </div>
  )

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{agent.icon}</span>
          <div>
            <div className="text-[11px] font-medium text-slate-200">{agent.name}</div>
            <div className="text-[9px] text-slate-500">{agent.role}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${statusColors[agent.status]||'bg-slate-600'}`}/>
          <span className="text-[9px] text-slate-400">{statusLabels[agent.status]||agent.status}</span>
          <button onClick={() => setShowConfig(!showConfig)}
            className={`ml-1 text-[10px] px-1.5 py-0.5 rounded ${showConfig ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
            {showConfig ? '返回' : '⚙'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        {!showConfig ? (
          <>
            <div className="space-y-1">
              {agent.logs.map((log,i) => (
                <div key={i} className={`text-[10px] leading-relaxed ${log.startsWith('⚠')?'text-amber-400':log.startsWith('→')?'text-slate-400':log.startsWith('💡')?'text-blue-300':'text-slate-300'}`}>
                  {!log.startsWith('→')&&!log.startsWith('⚠')&&!log.startsWith('💡')&&<span className="text-slate-600 mr-1">•</span>}{log}
                </div>
              ))}
            </div>
            {agent.id==='strategy' && pending.length>0 && (
              <div className="mt-2 pt-2 border-t border-slate-700/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-amber-400 font-medium">待审批 ({pending.length})</span>
                  <button onClick={approveAll} className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">全部批准</button>
                </div>
                {pending.slice(0,15).map((a:any) => (
                  <div key={a._id} className="flex items-center gap-1.5 py-1 border-b border-slate-700/20 last:border-0">
                    <span className={`text-[8px] px-1 py-0.5 rounded shrink-0 ${a.type==='pause'?'bg-red-500/20 text-red-400':'bg-blue-500/20 text-blue-400'}`}>{typeLabel(a.type)}</span>
                    <div className="flex-1 min-w-0 text-[9px] text-slate-300 truncate">{a.entityName||a.entityId}</div>
                    <button onClick={()=>approve(a._id)} className="px-1.5 py-0.5 text-[8px] bg-emerald-500/20 text-emerald-400 rounded">✓</button>
                    <button onClick={()=>reject(a._id)} className="px-1.5 py-0.5 text-[8px] bg-slate-700 text-slate-400 rounded">✗</button>
                  </div>
                ))}
              </div>
            )}
            {agent.id==='auditor' && lessons.length>0 && (
              <div className="mt-2 pt-2 border-t border-slate-700/30">
                {lessons.slice(0,5).map((l:any,i:number) => (
                  <div key={i} className="text-[9px] text-blue-300/80 py-0.5">💡 {l.content?.substring(0,70)} <span className="text-slate-600">({Math.round((l.confidence||0)*100)}%)</span></div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2.5">
            {/* 监控 */}
            {agent.id==='monitor' && <>
              <Sec title="扫描频率">{F('scanInterval','间隔','number',{suffix:'分钟'})}</Sec>
              <Sec title="事件检测阈值">
                {F('spendSpikeRatio','花费飙升倍数','number',{suffix:'x'})}
                {F('roasCrashPct','ROAS 暴跌','number',{suffix:'%'})}
                {F('zeroConvMinSpend','零转化最低花费','number',{suffix:'$'})}
              </Sec>
              <Sec title="Metabase 数据源 (JSON)">{TA('dataSources','',4)}</Sec>
            </>}

            {/* 策略 */}
            {agent.id==='strategy' && <>
              <Sec title="投放目标">
                {F('targetRoas','目标 ROAS','number')}
                {F('maxCpa','最大 CPA','number',{suffix:'$',placeholder:'可选'})}
                {F('budgetLimit','日预算上限','number',{suffix:'$',placeholder:'可选'})}
              </Sec>
              <Sec title="决策阈值">
                {F('lossSevereRoas','严重亏损 ROAS <','number')}
                {F('lossMildRoas','轻微亏损 ROAS <','number')}
                {F('highPotentialRoas','高潜力 ROAS ≥','number')}
                {F('observeMaxSpend','观察期花费 <','number',{suffix:'$'})}
              </Sec>
              {TA('customRules','自定义规则（每行一条）',3,'如: 周末不关停游戏类广告')}
            </>}

            {/* 执行 */}
            {agent.id==='executor' && <>
              <Sec title="权责范围">
                {TA('accountIds','可操作账户 ID（每行一个）',2)}
                {TA('packageNames','可操作包名（每行一个）',2)}
                {TA('optimizers','可操作优化师（每行一个）',2)}
              </Sec>
              <Sec title="操作权限（点击切换）">
                {Object.keys(permLabels).map(k => (
                  <div key={k} className="flex items-center justify-between py-0.5">
                    <span className="text-[9px] text-slate-300">{permLabels[k]}</span>
                    <button onClick={() => setForm({...form, [`perm_${k}`]: form[`perm_${k}`]==='auto' ? 'approve' : 'auto'})}
                      className={`text-[9px] px-2 py-0.5 rounded ${form[`perm_${k}`]==='auto' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {form[`perm_${k}`]==='auto' ? '自动' : '审批'}
                    </button>
                  </div>
                ))}
              </Sec>
              <Sec title="执行限制">
                {F('maxBudgetPct','单次预算变动','number',{suffix:'%'})}
                {F('maxDailyBudget','日预算上限','number',{suffix:'$'})}
                {F('cooldown','冷却时间','number',{suffix:'h'})}
                {F('maxActions','单次最多操作','number',{suffix:'个'})}
              </Sec>
            </>}

            {/* 审计 */}
            {agent.id==='auditor' && <>
              <Sec title="反思设置">
                {F('reflectionDelay','执行后多久反思','number',{suffix:'h'})}
                {F('reflectionWindow','反思窗口','number',{suffix:'h'})}
              </Sec>
              <Sec title="进化设置">
                {Toggle('evolutionEnabled','自动进化')}
                <div className="flex items-center justify-between py-0.5">
                  <span className="text-[9px] text-slate-400">周期</span>
                  <select value={form.evolutionSchedule||'weekly'} onChange={e=>setForm({...form,evolutionSchedule:e.target.value})}
                    className="px-1 py-0.5 bg-slate-700 border border-slate-600 rounded text-[9px] text-white outline-none">
                    <option value="daily">每天</option><option value="weekly">每周</option>
                  </select>
                </div>
              </Sec>
              {TA('lessonRules','经验沉淀规则（每行一条）',3,'如: 关停后ROAS反弹说明判断太早')}
              <Sec title="工作流控制">
                {Toggle('pauseOnLow','低准确率暂停 Agent')}
                {F('pauseThreshold','暂停阈值','number',{suffix:'%'})}
                {F('maxErrors','最大连续错误','number',{suffix:'次'})}
              </Sec>
            </>}

            <button onClick={save} disabled={saving}
              className="w-full py-1.5 text-[10px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50">
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Sec({title,children}:{title:string;children:React.ReactNode}) {
  return <div><div className="text-[9px] text-slate-500 font-medium mb-1">{title}</div>{children}</div>
}
