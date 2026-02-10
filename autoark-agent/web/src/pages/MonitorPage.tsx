import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function MonitorPage() {
  const [overview, setOverview] = useState<any>(null)
  const [actions, setActions] = useState<any[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    get('/api/monitor/overview').then(setOverview)
    get('/api/monitor/recent-actions').then(setActions)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b shadow-sm">
        <h1 className="text-lg font-bold text-slate-800">监控看板</h1>
        <div className="flex gap-3">
          <button onClick={() => navigate('/chat')} className="text-sm text-blue-500 hover:text-blue-700">返回对话</button>
          <button onClick={() => { localStorage.removeItem('token'); navigate('/login') }} className="text-sm text-red-400 hover:text-red-600">退出</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        {/* KPI 卡片 */}
        {overview?.totals && (
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: '总花费', value: `$${overview.totals.spend.toFixed(0)}`, color: 'text-slate-800' },
              { label: '总收入', value: `$${overview.totals.revenue.toFixed(0)}`, color: 'text-emerald-600' },
              { label: 'ROAS', value: overview.totals.roas, color: overview.totals.roas >= 1.5 ? 'text-emerald-600' : 'text-red-500' },
              { label: 'CTR', value: `${overview.totals.ctr}%`, color: 'text-blue-600' },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-xl border p-4 shadow-sm">
                <div className="text-xs text-slate-400 mb-1">{kpi.label}</div>
                <div className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* 趋势图 */}
        {overview?.daily?.length > 0 && (
          <div className="bg-white rounded-xl border p-6 shadow-sm">
            <h3 className="text-sm font-medium text-slate-700 mb-4">7 天花费 & ROAS 趋势</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={overview.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line yAxisId="left" type="monotone" dataKey="spend" stroke="#3b82f6" name="Spend ($)" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="roas" stroke="#10b981" name="ROAS" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 最近操作 */}
        <div className="bg-white rounded-xl border shadow-sm">
          <h3 className="text-sm font-medium text-slate-700 p-4 border-b">最近 Agent 操作</h3>
          <div className="divide-y">
            {actions.length === 0 && <div className="p-4 text-sm text-slate-400 text-center">暂无操作记录</div>}
            {actions.map((a: any) => (
              <div key={a._id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-sm text-slate-700">{a.type}</span>
                  <span className="text-xs text-slate-400 ml-2">{a.entityName || a.entityId}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    a.status === 'executed' ? 'bg-emerald-100 text-emerald-700' :
                    a.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    a.status === 'rejected' ? 'bg-red-100 text-red-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>{a.status}</span>
                  <span className="text-[10px] text-slate-400">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {!overview && <div className="text-center py-20 text-slate-400">加载中...</div>}
      </div>
    </div>
  )
}
