import { useState, useEffect } from 'react'
import { get, post } from '../api'

const TYPE_LABELS: Record<string, string> = {
  create_campaign: '创建广告系列',
  adjust_budget: '调整预算',
  pause: '暂停',
  resume: '恢复',
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  executed: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
}

export default function ActionCard({ actionId, onUpdate }: { actionId: string; onUpdate?: () => void }) {
  const [action, setAction] = useState<any>(null)
  const [acting, setActing] = useState(false)

  useEffect(() => {
    get(`/api/actions?status=pending`).then(actions => {
      const found = actions.find?.((a: any) => a._id === actionId)
      if (found) setAction(found)
      else get(`/api/actions`).then(all => setAction(all.find?.((a: any) => a._id === actionId)))
    })
  }, [actionId])

  if (!action) return null

  const approve = async () => {
    setActing(true)
    const res = await post(`/api/actions/${actionId}/approve`, {})
    setAction(res.action)
    onUpdate?.()
    setActing(false)
  }

  const reject = async () => {
    setActing(true)
    const res = await post(`/api/actions/${actionId}/reject`, { reason: 'User rejected' })
    setAction(res.action)
    onUpdate?.()
    setActing(false)
  }

  return (
    <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-600">
          {TYPE_LABELS[action.type] || action.type}
        </span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[action.status] || 'bg-slate-100 text-slate-600'}`}>
          {action.status}
        </span>
      </div>

      {action.entityName && (
        <div className="text-xs text-slate-500 mb-1">{action.entityName}</div>
      )}

      <div className="text-xs text-slate-700 mb-2">{action.reason}</div>

      {action.type === 'adjust_budget' && action.params && (
        <div className="text-xs text-slate-500 mb-2">
          ${action.params.currentBudget || '?'} → <span className="font-medium text-slate-700">${action.params.newBudget}</span>/天
        </div>
      )}

      {action.status === 'pending' && (
        <div className="flex gap-2">
          <button onClick={approve} disabled={acting}
            className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
            批准
          </button>
          <button onClick={reject} disabled={acting}
            className="flex-1 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-600 text-xs font-medium rounded-lg transition-colors disabled:opacity-50">
            拒绝
          </button>
        </div>
      )}

      {action.status === 'executed' && action.result && (
        <div className="text-[10px] text-emerald-600">已执行成功</div>
      )}
      {action.status === 'failed' && action.result?.error && (
        <div className="text-[10px] text-red-600">执行失败: {action.result.error}</div>
      )}
    </div>
  )
}
