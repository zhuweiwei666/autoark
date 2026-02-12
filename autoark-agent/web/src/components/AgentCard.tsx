/**
 * Agent 卡片组件 - 显示状态 + 日志 + 可展开配置面板
 */
import { useState } from 'react'
import { get, post } from '../api'

interface Props {
  agent: { id: string; name: string; icon: string; role: string; status: string; logs: string[] }
  config: any
  pending?: any[]
  lessons?: any[]
  skills?: any[]
  onRefresh: () => void
}

const statusColors: Record<string, string> = {
  online: 'bg-emerald-500', has_suggestions: 'bg-amber-500', active: 'bg-blue-500', standby: 'bg-slate-500', idle: 'bg-slate-600',
}
const statusLabels: Record<string, string> = {
  online: '运行中', has_suggestions: '有建议', active: '活跃', standby: '待命', idle: '空闲',
}

const permLabels: Record<string, string> = {
  pause_severe_loss: '暂停严重亏损', pause_mild_loss: '暂停轻微亏损', pause_zero_conversion: '暂停零转化',
  increase_budget: '加预算', decrease_budget: '减预算', resume: '恢复广告',
}

export default function AgentCard({ agent, config, pending = [], lessons = [], skills = [], onRefresh }: Props) {
  const [showConfig, setShowConfig] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const cfg = config?.[agent.id] || config || {}

  const saveConfig = async (updates: any) => {
    setSaving(true)
    try {
      await (await fetch(`/agent/api/agent-config/${agent.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify(updates),
      })).json()
      onRefresh()
      setEditing(null)
    } catch {}
    setSaving(false)
  }

  const approve = async (id: string) => { await post(`/api/actions/${id}/approve`, {}); onRefresh() }
  const reject = async (id: string) => { await post(`/api/actions/${id}/reject`, { reason: 'rejected' }); onRefresh() }
  const approveAll = async () => { await post('/api/actions/approve-all', { actionIds: pending.map((a: any) => a._id) }); onRefresh() }

  const typeLabel = (t: string) => ({ pause: '暂停', adjust_budget: '调预算', resume: '恢复' }[t] || t)

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden min-h-0">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{agent.icon}</span>
          <div>
            <div className="text-[11px] font-medium text-slate-200">{agent.name}</div>
            <div className="text-[9px] text-slate-500">{agent.role}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${statusColors[agent.status] || 'bg-slate-600'}`} />
          <span className="text-[9px] text-slate-400">{statusLabels[agent.status] || agent.status}</span>
          <button onClick={() => setShowConfig(!showConfig)}
            className={`ml-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${showConfig ? 'bg-blue-500/20 text-blue-400' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
            {showConfig ? '✕' : '⚙'}
          </button>
        </div>
      </div>

      {/* 内容区 - 滚动 */}
      <div className="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        {!showConfig ? (
          <>
            {/* 日志 */}
            <div className="space-y-1">
              {agent.logs.map((log, i) => (
                <div key={i} className={`text-[10px] leading-relaxed ${log.startsWith('⚠') ? 'text-amber-400' : log.startsWith('→') ? 'text-slate-400' : log.startsWith('💡') ? 'text-blue-300' : 'text-slate-300'}`}>
                  {!log.startsWith('→') && !log.startsWith('⚠') && !log.startsWith('💡') && <span className="text-slate-600 mr-1">•</span>}{log}
                </div>
              ))}
            </div>

            {/* 策略: 审批 */}
            {agent.id === 'strategy' && pending.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] text-amber-400 font-medium">待审批 ({pending.length})</span>
                  <button onClick={approveAll} className="text-[9px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">全部批准</button>
                </div>
                {pending.slice(0, 15).map((a: any) => (
                  <div key={a._id} className="flex items-center gap-1.5 py-1 border-b border-slate-700/20 last:border-0">
                    <span className={`text-[8px] px-1 py-0.5 rounded shrink-0 ${a.type === 'pause' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>{typeLabel(a.type)}</span>
                    <div className="flex-1 min-w-0 text-[9px] text-slate-300 truncate">{a.entityName || a.entityId}</div>
                    <button onClick={() => approve(a._id)} className="px-1.5 py-0.5 text-[8px] bg-emerald-500/20 text-emerald-400 rounded">✓</button>
                    <button onClick={() => reject(a._id)} className="px-1.5 py-0.5 text-[8px] bg-slate-700 text-slate-400 rounded">✗</button>
                  </div>
                ))}
              </div>
            )}

            {/* 审计: 经验 */}
            {agent.id === 'auditor' && lessons.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-700/30">
                {lessons.slice(0, 5).map((l: any, i: number) => (
                  <div key={i} className="text-[9px] text-blue-300/80 py-0.5">💡 {l.content?.substring(0, 70)} <span className="text-slate-600">({Math.round((l.confidence || 0) * 100)}%)</span></div>
                ))}
              </div>
            )}
          </>
        ) : (
          /* ======= 配置面板 ======= */
          <div className="space-y-3">
            {/* 监控 Agent 配置 */}
            {agent.id === 'monitor' && (
              <>
                <Section title="Metabase 数据源">
                  {cfg.dataSources?.map((ds: any, i: number) => (
                    <div key={i} className="bg-slate-900/50 rounded p-2 mb-1">
                      <div className="text-[10px] text-slate-200">{ds.name}</div>
                      <div className="text-[9px] text-slate-500">Card ID: {ds.cardId} | Code: {ds.accessCode?.substring(0, 8)}...</div>
                      <div className="text-[9px] text-slate-500">{ds.description}</div>
                    </div>
                  )) || <div className="text-[9px] text-slate-500">未配置</div>}
                </Section>
                <Section title="扫描频率">
                  <div className="text-[10px] text-slate-300">每 {cfg.scanIntervalMinutes || 10} 分钟扫描一次</div>
                </Section>
                <Section title="事件检测阈值">
                  <KV label="花费飙升倍数" value={cfg.eventThresholds?.spendSpikeRatio || 2} suffix="x" />
                  <KV label="ROAS 暴跌" value={cfg.eventThresholds?.roasCrashDropPct || 50} suffix="%" />
                  <KV label="零转化最低花费" value={cfg.eventThresholds?.zeroConversionMinSpend || 50} prefix="$" />
                </Section>
              </>
            )}

            {/* 策略 Agent 配置 */}
            {agent.id === 'strategy' && (
              <>
                <Section title="投放目标">
                  <KV label="目标 ROAS" value={cfg.objectives?.targetRoas || 1.5} />
                  <KV label="最大 CPA" value={cfg.objectives?.maxCpa || '未设置'} prefix="$" />
                  <KV label="日预算上限" value={cfg.objectives?.dailyBudgetLimit || '未设置'} prefix="$" />
                </Section>
                <Section title="决策阈值">
                  <KV label="严重亏损 ROAS" value={cfg.thresholds?.loss_severe_roas || 0.3} prefix="<" />
                  <KV label="轻微亏损 ROAS" value={cfg.thresholds?.loss_mild_roas || 0.8} prefix="<" />
                  <KV label="高潜力 ROAS" value={cfg.thresholds?.high_potential_roas || 2.5} prefix="≥" />
                  <KV label="观察期花费" value={cfg.thresholds?.observe_max_spend || 30} prefix="<$" />
                </Section>
                <Section title="活跃 Skill">
                  {skills.length > 0 ? skills.map((s: any) => (
                    <div key={s._id} className="text-[9px] text-slate-300 py-0.5">
                      <span className={s.isActive ? 'text-emerald-400' : 'text-slate-500'}>{s.isActive ? '●' : '○'}</span> {s.name}
                    </div>
                  )) : <div className="text-[9px] text-slate-500">未配置 Skill</div>}
                </Section>
                <Section title="自定义规则">
                  {cfg.customRules?.length > 0 ? cfg.customRules.map((r: string, i: number) => (
                    <div key={i} className="text-[9px] text-slate-300 py-0.5">• {r}</div>
                  )) : <div className="text-[9px] text-slate-500">无自定义规则</div>}
                </Section>
              </>
            )}

            {/* 执行 Agent 配置 */}
            {agent.id === 'executor' && (
              <>
                <Section title="权责范围">
                  <KV label="账户" value={cfg.scope?.accountIds?.join(', ') || '未限制'} />
                  <KV label="产品" value={cfg.scope?.packageNames?.join(', ') || '未限制'} />
                  <KV label="优化师" value={cfg.scope?.optimizers?.join(', ') || '未限制'} />
                </Section>
                <Section title="操作权限">
                  {Object.entries(cfg.permissions || {}).map(([key, val]: [string, any]) => (
                    <div key={key} className="flex items-center justify-between py-0.5">
                      <span className="text-[9px] text-slate-300">{permLabels[key] || key}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${val === 'auto' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                        {val === 'auto' ? '自动执行' : '需审批'}
                      </span>
                    </div>
                  ))}
                </Section>
                <Section title="执行限制">
                  <KV label="单次预算变动" value={cfg.limits?.maxBudgetChangePct || 30} suffix="%" />
                  <KV label="日预算上限" value={cfg.limits?.maxDailyBudget || 500} prefix="$" />
                  <KV label="冷却时间" value={cfg.limits?.cooldownHours || 24} suffix="h" />
                  <KV label="单次最多操作" value={cfg.limits?.maxActionsPerRun || 50} suffix="个" />
                </Section>
              </>
            )}

            {/* 审计 Agent 配置 */}
            {agent.id === 'auditor' && (
              <>
                <Section title="反思设置">
                  <KV label="执行后多久反思" value={cfg.reflectionDelayHours || 2} suffix="h" />
                  <KV label="反思窗口" value={cfg.reflectionWindowHours || 24} suffix="h" />
                </Section>
                <Section title="进化设置">
                  <KV label="自动进化" value={cfg.evolutionEnabled !== false ? '开启' : '关闭'} />
                  <KV label="进化周期" value={cfg.evolutionSchedule || 'weekly'} />
                </Section>
                <Section title="经验沉淀规则">
                  {cfg.lessonRules?.length > 0 ? cfg.lessonRules.map((r: string, i: number) => (
                    <div key={i} className="text-[9px] text-slate-300 py-0.5">• {r}</div>
                  )) : <div className="text-[9px] text-slate-500">无自定义规则</div>}
                </Section>
                <Section title="工作流控制">
                  <KV label="低准确率暂停" value={cfg.workflowControl?.pauseOnLowAccuracy ? `是 (<${cfg.workflowControl.pauseAccuracyThreshold}%)` : '否'} />
                  <KV label="最大连续错误" value={cfg.workflowControl?.maxConsecutiveErrors || 5} suffix="次" />
                </Section>
              </>
            )}

            {/* 通用: 上下文 */}
            <Section title="自定义上下文（注入 LLM）">
              <div className="text-[9px] text-slate-400">{config?.customContext || '未配置'}</div>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-slate-500 font-medium mb-1 uppercase tracking-wider">{title}</div>
      {children}
    </div>
  )
}

function KV({ label, value, prefix, suffix }: { label: string; value: any; prefix?: string; suffix?: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[9px] text-slate-400">{label}</span>
      <span className="text-[10px] text-slate-200">{prefix}{value}{suffix}</span>
    </div>
  )
}
