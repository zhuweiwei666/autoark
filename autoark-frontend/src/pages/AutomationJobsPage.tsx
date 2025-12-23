import { useEffect, useMemo, useState } from 'react'
import { authFetch } from '../services/api'

type AutomationJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

interface AutomationJob {
  _id: string
  type: string
  status: AutomationJobStatus
  idempotencyKey: string
  agentId?: string
  createdBy?: string
  attempts?: number
  maxAttempts?: number
  lastError?: string
  result?: any
  payload?: any
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

const STATUS_BADGE: Record<AutomationJobStatus, string> = {
  queued: 'bg-yellow-100 text-yellow-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-700',
}

export default function AutomationJobsPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [jobs, setJobs] = useState<AutomationJob[]>([])
  const [selectedJob, setSelectedJob] = useState<AutomationJob | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [total, setTotal] = useState(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // create form
  const [createType, setCreateType] = useState('RUN_AGENT_AS_JOBS')
  const [createPayload, setCreatePayload] = useState('{\n  "agentId": ""\n}')
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState('')
  const [creating, setCreating] = useState(false)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize])

  const loadJobs = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterStatus) params.append('status', filterStatus)
      if (filterType) params.append('type', filterType)
      params.append('page', String(page))
      params.append('pageSize', String(pageSize))

      const res = await authFetch(`/api/automation-jobs?${params.toString()}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '加载失败')

      const list: AutomationJob[] = data.data?.list || []
      setJobs(list)
      setTotal(Number(data.data?.total || 0))

      if (selectedJob) {
        const updated = list.find((j) => j._id === selectedJob._id)
        if (updated) setSelectedJob(updated)
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '加载失败' })
    } finally {
      setLoading(false)
    }
  }

  const loadJobDetail = async (id: string) => {
    setRefreshing(true)
    try {
      const res = await authFetch(`/api/automation-jobs/${id}`)
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '加载失败')
      setSelectedJob(data.data)
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '加载失败' })
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterStatus, filterType])

  // auto refresh for running
  useEffect(() => {
    const hasRunning = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (!hasRunning) return
    const t = setInterval(() => loadJobs({ silent: true }), 5000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs])

  const cancelJob = async (id: string) => {
    if (!confirm('确定要取消这个 Job 吗？')) return
    try {
      const res = await authFetch(`/api/automation-jobs/${id}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '取消失败')
      setMessage({ type: 'success', text: '已取消' })
      await loadJobs({ silent: true })
      if (selectedJob?._id === id) await loadJobDetail(id)
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '取消失败' })
    }
  }

  const retryJob = async (id: string) => {
    try {
      const res = await authFetch(`/api/automation-jobs/${id}/retry`, { method: 'POST' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '重试失败')
      setMessage({ type: 'success', text: '已重试（重新入队）' })
      await loadJobs({ silent: true })
      if (selectedJob?._id === id) await loadJobDetail(id)
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '重试失败' })
    }
  }

  const createJob = async () => {
    setCreating(true)
    try {
      let payloadObj: any = {}
      try {
        payloadObj = createPayload.trim() ? JSON.parse(createPayload) : {}
      } catch {
        throw new Error('Payload 必须是合法 JSON')
      }

      const res = await authFetch(`/api/automation-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: createType,
          payload: payloadObj,
          agentId: payloadObj?.agentId || undefined,
          idempotencyKey: createIdempotencyKey || undefined,
          priority: 5,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || '创建失败')

      setMessage({ type: 'success', text: `Job 已创建：${data.data._id}` })
      setSelectedJob(data.data)
      await loadJobs({ silent: true })
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message || '创建失败' })
    } finally {
      setCreating(false)
    }
  }

  const formatTime = (iso?: string) => {
    if (!iso) return '-'
    try {
      return new Date(iso).toLocaleString('zh-CN')
    } catch {
      return iso
    }
  }

  if (loading && jobs.length === 0) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-xl border border-slate-200 p-6 text-slate-500">加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <h1 className="text-2xl font-bold text-slate-900">Automation Jobs</h1>
          <p className="text-slate-500 mt-1">查看 AI/自动化任务队列（幂等、可重试、可审计）</p>
        </header>

        {message && (
          <div
            className={`p-4 rounded-2xl border flex items-center justify-between ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <span className="text-sm">{message.text}</span>
            <button onClick={() => setMessage(null)} className="p-2 rounded-xl hover:bg-white/50">
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-6">
          {/* left: list */}
          <div className="col-span-1 bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Job 列表</div>
                <button
                  onClick={() => loadJobs()}
                  className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  刷新
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={filterStatus}
                  onChange={(e) => { setPage(1); setFilterStatus(e.target.value) }}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="">全部状态</option>
                  <option value="queued">queued</option>
                  <option value="running">running</option>
                  <option value="completed">completed</option>
                  <option value="failed">failed</option>
                  <option value="cancelled">cancelled</option>
                </select>
                <input
                  value={filterType}
                  onChange={(e) => { setPage(1); setFilterType(e.target.value) }}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  placeholder="按 type 过滤"
                />
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-[560px] overflow-y-auto">
              {jobs.length === 0 ? (
                <div className="p-6 text-center text-slate-500">暂无 Job</div>
              ) : (
                jobs.map((j) => (
                  <div
                    key={j._id}
                    onClick={() => loadJobDetail(j._id)}
                    className={`p-4 cursor-pointer hover:bg-slate-50 ${
                      selectedJob?._id === j._id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[j.status]}`}>{j.status}</span>
                      <span className="text-xs text-slate-400">{formatTime(j.createdAt).split(' ')[0]}</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-slate-800 truncate">{j.type}</div>
                    <div className="text-xs text-slate-500 font-mono truncate mt-1">{j._id}</div>
                    {j.lastError && <div className="text-xs text-red-600 truncate mt-1">{j.lastError}</div>}
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-slate-200 flex items-center justify-between text-sm">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-50"
              >
                上一页
              </button>
              <span className="text-slate-600">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 border border-slate-300 rounded-lg disabled:opacity-50"
              >
                下一页
              </button>
            </div>
          </div>

          {/* right: detail + create */}
          <div className="col-span-2 space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold">创建 Job</div>
                <div className="text-xs text-slate-500">支持幂等（idempotencyKey）</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">type</label>
                  <select
                    value={createType}
                    onChange={(e) => setCreateType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  >
                    <option value="RUN_AGENT_AS_JOBS">RUN_AGENT_AS_JOBS</option>
                    <option value="RUN_AGENT">RUN_AGENT</option>
                    <option value="EXECUTE_AGENT_OPERATION">EXECUTE_AGENT_OPERATION</option>
                    <option value="PUBLISH_DRAFT">PUBLISH_DRAFT</option>
                    <option value="RUN_FB_FULL_SYNC">RUN_FB_FULL_SYNC</option>
                    <option value="SYNC_FB_USER_ASSETS">SYNC_FB_USER_ASSETS</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">idempotencyKey（可选）</label>
                  <input
                    value={createIdempotencyKey}
                    onChange={(e) => setCreateIdempotencyKey(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                    placeholder="留空则后端自动生成 hash key"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-slate-500 mb-1">payload (JSON)</label>
                <textarea
                  value={createPayload}
                  onChange={(e) => setCreatePayload(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                />
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={createJob}
                  disabled={creating}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creating ? '创建中...' : '创建并入队'}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <div className="font-semibold">Job 详情</div>
                {selectedJob && (
                  <button
                    onClick={() => loadJobDetail(selectedJob._id)}
                    disabled={refreshing}
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                  >
                    {refreshing ? '刷新中...' : '刷新'}
                  </button>
                )}
              </div>

              {!selectedJob ? (
                <div className="mt-6 text-slate-500">从左侧选择一个 Job 查看详情</div>
              ) : (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{selectedJob.type}</div>
                      <div className="text-xs text-slate-500 font-mono mt-1">{selectedJob._id}</div>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[selectedJob.status]}`}>
                      {selectedJob.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <div className="text-xs text-slate-500">attempts</div>
                      <div className="font-semibold text-slate-800">{selectedJob.attempts ?? 0} / {selectedJob.maxAttempts ?? 0}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <div className="text-xs text-slate-500">startedAt</div>
                      <div className="text-slate-700">{formatTime(selectedJob.startedAt)}</div>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <div className="text-xs text-slate-500">finishedAt</div>
                      <div className="text-slate-700">{formatTime(selectedJob.finishedAt)}</div>
                    </div>
                  </div>

                  {selectedJob.lastError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-sm whitespace-pre-wrap">
                      {selectedJob.lastError}
                    </div>
                  )}

                  <details className="p-3 bg-slate-50 rounded-xl">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">payload</summary>
                    <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(selectedJob.payload || {}, null, 2)}</pre>
                  </details>
                  <details className="p-3 bg-slate-50 rounded-xl">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">result</summary>
                    <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(selectedJob.result || {}, null, 2)}</pre>
                  </details>

                  <div className="flex gap-2">
                    {selectedJob.status !== 'completed' && selectedJob.status !== 'cancelled' && (
                      <button
                        onClick={() => cancelJob(selectedJob._id)}
                        className="px-4 py-2 bg-red-100 text-red-700 rounded-xl hover:bg-red-200 text-sm"
                      >
                        取消
                      </button>
                    )}
                    {selectedJob.status === 'failed' && (
                      <button
                        onClick={() => retryJob(selectedJob._id)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm"
                      >
                        重试
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

