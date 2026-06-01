import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import Loading from '../components/Loading'
import { authFetch } from '../services/api'

const API_BASE = '/api'

interface AdDetail {
  adId: string
  adName: string
  effectiveStatus?: string
  reviewFeedback?: any
}

interface TaskError {
  entityType: string
  errorCode?: string
  errorMessage: string
  customerMessage?: string
  operatorMessage?: string
  severity?: 'error' | 'warning'
  retryable?: boolean
  nextActions?: string[]
  source?: 'meta' | 'autoark' | 'worker' | 'validation'
  rawCode?: string | number
  rawSubcode?: string | number
  timestamp?: string
}

interface TaskItem {
  accountId: string
  accountName: string
  status: string
  progress: { current: number; total: number; percentage: number }
  result?: { campaignId?: string; adsetIds?: string[]; adIds?: string[]; createdCount?: number }
  ads?: AdDetail[]  // 广告详情（含审核状态）
  errors?: TaskError[]
  startedAt?: string
  completedAt?: string
}

interface ReviewStatus {
  total: number
  pending: number
  approved: number
  rejected: number
  lastCheckedAt?: string
}

interface Task {
  _id: string
  name?: string  // 🆕 任务名称
  taskType: string
  status: string
  platform: string
  items: TaskItem[]
  progress: {
    totalAccounts: number
    completedAccounts: number
    successAccounts: number
    failedAccounts: number
    totalAds: number
    createdAds: number
    percentage: number
  }
  reviewStatus?: ReviewStatus  // 审核状态统计
  createdAt: string
  startedAt?: string
  completedAt?: string
  duration?: number
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '等待中', color: 'bg-slate-100 text-slate-600' },
  queued: { label: '排队中', color: 'bg-yellow-100 text-yellow-600' },
  processing: { label: '执行中', color: 'bg-blue-100 text-blue-600' },
  running: { label: '执行中', color: 'bg-blue-100 text-blue-600' },
  success: { label: '成功', color: 'bg-green-100 text-green-600' },
  completed: { label: '成功', color: 'bg-green-100 text-green-600' },
  partial: { label: '部分成功', color: 'bg-orange-100 text-orange-600' },
  partial_success: { label: '部分成功', color: 'bg-orange-100 text-orange-600' },
  failed: { label: '失败', color: 'bg-red-100 text-red-600' },
  cancelled: { label: '已取消', color: 'bg-slate-100 text-slate-600' },
}

// 广告审核状态映射
const REVIEW_STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_REVIEW: { label: '审核中', color: 'bg-yellow-100 text-yellow-700', icon: '⏳' },
  ACTIVE: { label: '通过', color: 'bg-green-100 text-green-700', icon: '✅' },
  DISAPPROVED: { label: '被拒', color: 'bg-red-100 text-red-700', icon: '❌' },
  PAUSED: { label: '暂停', color: 'bg-slate-100 text-slate-600', icon: '⏸️' },
  PREAPPROVED: { label: '预通过', color: 'bg-blue-100 text-blue-700', icon: '🔵' },
  WITH_ISSUES: { label: '有问题', color: 'bg-orange-100 text-orange-700', icon: '⚠️' },
}

// 获取审核状态信息
const getReviewStatusInfo = (status: string) => {
  return REVIEW_STATUS_MAP[status] || { label: status || '未知', color: 'bg-slate-100 text-slate-600', icon: '❓' }
}

const getErrorSourceLabel = (source?: string) => {
  const labels: Record<string, string> = {
    meta: 'Meta',
    autoark: 'AutoArk',
    worker: 'Worker',
    validation: '配置校验',
  }
  return source ? labels[source] || source : '未知来源'
}

const getErrorPrimaryMessage = (error: TaskError) => {
  return error.customerMessage || error.errorMessage || '任务执行失败'
}

const getErrorOperatorMessage = (error: TaskError) => {
  return error.operatorMessage || error.errorMessage
}

const getErrorCodeLabel = (error: TaskError) => {
  return error.errorCode || error.entityType || 'EXECUTION_ERROR'
}

export default function TaskManagementPage() {
  const [searchParams] = useSearchParams()
  const taskIdFromUrl = searchParams.get('taskId')
  
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [checkingReview, setCheckingReview] = useState(false)
  const [reviewDetails, setReviewDetails] = useState<any>(null)
  
  // 🆕 倍率执行弹窗状态
  const [showRerunModal, setShowRerunModal] = useState(false)
  const [rerunMultiplier, setRerunMultiplier] = useState(1)
  const [rerunTaskId, setRerunTaskId] = useState<string>('')
  const [rerunning, setRerunning] = useState(false)
  
  useEffect(() => {
    loadTasks()
    const interval = setInterval(loadTasks, 5000) // Auto refresh every 5s
    return () => clearInterval(interval)
  }, [])
  
  useEffect(() => {
    if (taskIdFromUrl && tasks.length > 0) {
      const task = tasks.find(t => t._id === taskIdFromUrl)
      if (task) setSelectedTask(task)
    }
  }, [taskIdFromUrl, tasks])
  
  const loadTasks = async () => {
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks`)
      const data = await res.json()
      if (data.success) {
        setTasks(data.data?.list || [])
      }
    } catch (err) {
      console.error('Failed to load tasks:', err)
    } finally {
      setLoading(false)
    }
  }
  
  const loadTaskDetail = async (taskId: string) => {
    setRefreshing(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks/${taskId}`)
      const data = await res.json()
      if (data.success) {
        setSelectedTask(data.data)
        // Update in list too
        setTasks(tasks.map(t => t._id === taskId ? data.data : t))
        // 加载审核详情
        loadReviewDetails(taskId)
      }
    } catch (err) {
      console.error('Failed to load task detail:', err)
    } finally {
      setRefreshing(false)
    }
  }
  
  const handleCancel = async (taskId: string) => {
    if (!confirm('确定要取消此任务吗？')) return
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks/${taskId}/cancel`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        loadTasks()
        if (selectedTask?._id === taskId) loadTaskDetail(taskId)
      }
    } catch (err) {
      console.error('Failed to cancel task:', err)
    }
  }
  
  const handleRetry = async (taskId: string) => {
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks/${taskId}/retry`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        loadTasks()
        if (selectedTask?._id === taskId) loadTaskDetail(taskId)
      }
    } catch (err) {
      console.error('Failed to retry task:', err)
    }
  }
  
  // 🆕 打开倍率选择弹窗
  const openRerunModal = (taskId: string) => {
    setRerunTaskId(taskId)
    setRerunMultiplier(1)
    setShowRerunModal(true)
  }
  
  // 🆕 执行倍率重跑
  const handleRerun = async () => {
    if (!rerunTaskId) return
    setRerunning(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks/${rerunTaskId}/rerun`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ multiplier: rerunMultiplier })
      })
      const data = await res.json()
      if (data.success) {
        const count = data.data.length || 1
        alert(`已创建 ${count} 个新任务`)
        loadTasks()
        setShowRerunModal(false)
        // 选中第一个新任务
        if (data.data[0]) setSelectedTask(data.data[0])
      } else {
        alert(`重新执行失败：${data.error}`)
      }
    } catch (err) {
      console.error('Failed to rerun task:', err)
      alert('重新执行失败')
    } finally {
      setRerunning(false)
    }
  }
  
  // 检查广告审核状态
  const checkReviewStatus = async (taskId: string) => {
    setCheckingReview(true)
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks/${taskId}/check-review`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        // 重新加载任务详情
        loadTaskDetail(taskId)
        // 加载审核详情
        loadReviewDetails(taskId)
      } else {
        alert(`检查审核状态失败：${data.error || data.data?.errors?.join(', ')}`)
      }
    } catch (err) {
      console.error('Failed to check review status:', err)
      alert('检查审核状态失败')
    } finally {
      setCheckingReview(false)
    }
  }
  
  // 加载审核详情
  const loadReviewDetails = async (taskId: string) => {
    try {
      const res = await authFetch(`${API_BASE}/bulk-ad/tasks/${taskId}/review-status`)
      const data = await res.json()
      if (data.success) {
        setReviewDetails(data.data)
      }
    } catch (err) {
      console.error('Failed to load review details:', err)
    }
  }
  
  const formatDuration = (ms?: number) => {
    if (!ms) return '-'
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}秒`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}分${seconds % 60}秒`
  }
  
  const formatTime = (iso?: string) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('zh-CN')
  }
  
  if (loading) {
    return <Loading.Page message="加载任务列表..." />
  }
  
  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">任务管理</h1>
          <p className="text-slate-500 mt-1">查看和管理批量广告创建任务</p>
        </div>
        
        <div className="grid grid-cols-3 gap-6">
          {/* Task List */}
          <div className="col-span-1 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="font-semibold">任务列表</h2>
            </div>
            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
              {tasks.length === 0 ? (
                <div className="p-4 text-center text-slate-500">暂无任务</div>
              ) : (
                tasks.map(task => (
                  <div
                    key={task._id}
                    onClick={() => loadTaskDetail(task._id)}
                    className={`p-4 cursor-pointer hover:bg-slate-50 transition-colors ${selectedTask?._id === task._id ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs px-2 py-1 rounded ${STATUS_MAP[task.status]?.color || 'bg-slate-100'}`}>
                        {STATUS_MAP[task.status]?.label || task.status}
                      </span>
                      <span className="text-xs text-slate-400">{formatTime(task.createdAt).split(' ')[0]}</span>
                    </div>
                    <div className="text-sm font-medium text-slate-700 truncate">{task.name || `任务 #${task._id.slice(-6)}`}</div>
                    <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
                      <span>{task.progress.totalAccounts} 个账户</span>
                      <span>{task.progress.percentage}%</span>
                    </div>
                    <div className="mt-2 h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-all ${task.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${task.progress.percentage}%` }} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          {/* Task Detail */}
          <div className="col-span-2 bg-white rounded-xl border border-slate-200">
            {selectedTask ? (
              <div>
                <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold">{selectedTask.name || '任务详情'}</h2>
                    <span className="text-xs text-slate-500">ID: {selectedTask._id}</span>
                  </div>
                  <div className="flex gap-2">
                    {['pending', 'queued', 'processing'].includes(selectedTask.status) && (
                      <button onClick={() => handleCancel(selectedTask._id)} className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50">取消任务</button>
                    )}
                    {['failed', 'partial_success'].includes(selectedTask.status) && (
                      <button onClick={() => handleRetry(selectedTask._id)} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">重试失败项</button>
                    )}
                    {['success', 'failed', 'partial_success', 'cancelled', 'completed'].includes(selectedTask.status) && (
                      <button onClick={() => openRerunModal(selectedTask._id)} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">🔄 再次执行</button>
                    )}
                    <button onClick={() => loadTaskDetail(selectedTask._id)} disabled={refreshing} className="px-3 py-1 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50">
                      {refreshing ? '刷新中...' : '刷新'}
                    </button>
                  </div>
                </div>
                
                <div className="p-4 border-b border-slate-200">
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div><div className="text-2xl font-bold text-slate-700">{selectedTask.progress.totalAccounts}</div><div className="text-xs text-slate-500">总账户</div></div>
                    <div><div className="text-2xl font-bold text-green-600">{selectedTask.progress.successAccounts}</div><div className="text-xs text-slate-500">成功</div></div>
                    <div><div className="text-2xl font-bold text-red-600">{selectedTask.progress.failedAccounts}</div><div className="text-xs text-slate-500">失败</div></div>
                    <div><div className="text-2xl font-bold text-blue-600">{selectedTask.progress.createdAds}</div><div className="text-xs text-slate-500">已创建广告</div></div>
                  </div>
                  <div className="mt-4">
                    <div className="flex justify-between text-sm mb-1"><span>总体进度</span><span>{selectedTask.progress.percentage}%</span></div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full transition-all ${selectedTask.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${selectedTask.progress.percentage}%` }} />
                    </div>
                  </div>
                </div>
                
                {/* 广告审核状态 */}
                {['success', 'partial_success'].includes(selectedTask.status) && (
                  <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm">📋 广告审核状态</h3>
                      <button
                        onClick={() => checkReviewStatus(selectedTask._id)}
                        disabled={checkingReview}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {checkingReview ? '检查中...' : '🔄 刷新审核状态'}
                      </button>
                    </div>
                    
                    {reviewDetails?.summary ? (
                      <div className="grid grid-cols-4 gap-3 text-center">
                        <div className="bg-white p-2 rounded-lg border">
                          <div className="text-lg font-bold text-slate-700">{reviewDetails.summary.total}</div>
                          <div className="text-xs text-slate-500">总广告</div>
                        </div>
                        <div className="bg-white p-2 rounded-lg border">
                          <div className="text-lg font-bold text-yellow-600">⏳ {reviewDetails.summary.pending}</div>
                          <div className="text-xs text-slate-500">审核中</div>
                        </div>
                        <div className="bg-white p-2 rounded-lg border">
                          <div className="text-lg font-bold text-green-600">✅ {reviewDetails.summary.approved}</div>
                          <div className="text-xs text-slate-500">已通过</div>
                        </div>
                        <div className="bg-white p-2 rounded-lg border">
                          <div className="text-lg font-bold text-red-600">❌ {reviewDetails.summary.rejected}</div>
                          <div className="text-xs text-slate-500">被拒绝</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center text-sm text-slate-500 py-2">
                        点击"刷新审核状态"查看广告审核情况
                      </div>
                    )}
                    
                    {reviewDetails?.summary?.lastCheckedAt && (
                      <div className="text-xs text-slate-400 mt-2 text-right">
                        上次检查: {formatTime(reviewDetails.summary.lastCheckedAt)}
                      </div>
                    )}
                    
                    {/* 被拒广告详情 */}
                    {reviewDetails?.ads?.filter((ad: any) => ad.effectiveStatus === 'DISAPPROVED').length > 0 && (
                      <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                        <h4 className="text-sm font-medium text-red-700 mb-2">❌ 被拒绝的广告</h4>
                        <div className="space-y-2 max-h-32 overflow-y-auto">
                          {reviewDetails.ads
                            .filter((ad: any) => ad.effectiveStatus === 'DISAPPROVED')
                            .map((ad: any) => {
                              const statusInfo = getReviewStatusInfo(ad.effectiveStatus)
                              return (
                                <div key={ad.adId} className="text-xs">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded ${statusInfo.color}`}>{statusInfo.icon} {statusInfo.label}</span>
                                    <span className="font-medium text-red-800">{ad.name || ad.adId}</span>
                                  </div>
                                  {ad.rejectionReasons?.length > 0 && (
                                    <div className="text-red-600 mt-0.5 ml-4">
                                      {ad.rejectionReasons.join(' | ')}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="p-4 border-b border-slate-200 grid grid-cols-3 gap-4 text-sm">
                  <div><span className="text-slate-500">状态：</span><span className={`px-2 py-0.5 rounded ${STATUS_MAP[selectedTask.status]?.color}`}>{STATUS_MAP[selectedTask.status]?.label}</span></div>
                  <div><span className="text-slate-500">开始时间：</span>{formatTime(selectedTask.startedAt)}</div>
                  <div><span className="text-slate-500">耗时：</span>{formatDuration(selectedTask.duration)}</div>
                </div>
                
                <div className="p-4">
                  <h3 className="font-semibold mb-3">账户执行详情</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {selectedTask.items.map((item, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className={`w-2 h-2 shrink-0 rounded-full ${(item.status === 'success' || item.status === 'completed') ? 'bg-green-500' : item.status === 'failed' ? 'bg-red-500' : item.status === 'processing' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{item.accountName || item.accountId}</div>
                              <div className="text-xs text-slate-500 break-all">{item.accountId}</div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_MAP[item.status]?.color || 'bg-slate-100'}`}>{STATUS_MAP[item.status]?.label || item.status}</span>
                            {item.result?.createdCount !== undefined && <div className="text-xs text-slate-500 mt-1">创建 {item.result.createdCount} 个广告</div>}
                          </div>
                        </div>
                        {item.errors && item.errors.length > 0 && (
                          <div className="mt-3 space-y-3 border-l-2 border-red-300 pl-3">
                            {item.errors.map((error, errorIdx) => (
                              <div key={`${getErrorCodeLabel(error)}-${errorIdx}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                                    {getErrorCodeLabel(error)}
                                  </span>
                                  <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${error.retryable ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-700'}`}>
                                    {error.retryable ? '可重试' : '需先处理'}
                                  </span>
                                  <span className="text-[11px] text-slate-500">{getErrorSourceLabel(error.source)}</span>
                                </div>
                                <div className="mt-1 text-sm font-medium text-red-700 break-words">
                                  {getErrorPrimaryMessage(error)}
                                </div>
                                {error.nextActions && error.nextActions.length > 0 && (
                                  <div className="mt-2">
                                    <div className="text-xs font-medium text-slate-600">建议动作</div>
                                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-5 text-slate-600">
                                      {error.nextActions.slice(0, 3).map((action, actionIdx) => (
                                        <li key={actionIdx}>{action}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {getErrorOperatorMessage(error) && (
                                  <details className="mt-2 text-xs text-slate-500">
                                    <summary className="cursor-pointer select-none text-slate-600">原始错误</summary>
                                    <div className="mt-1 whitespace-pre-wrap break-words rounded bg-white px-2 py-1 text-slate-500">
                                      {getErrorOperatorMessage(error)}
                                    </div>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-96 text-slate-500">
                <div className="text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-12 h-12 mx-auto mb-3 text-slate-300">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.25 2.25 0 002.25 2.25h.75m0-3H12m5.25-3.75h-1.5m1.5 3.75h-1.5m-4.5-3.75h1.5m-1.5 3.75h1.5" />
                  </svg>
                  <p>选择一个任务查看详情</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* 🆕 倍率执行弹窗 */}
      {showRerunModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-96 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">🔄 再次执行任务</h3>
            <p className="text-sm text-slate-600 mb-4">选择执行次数，将基于原任务配置创建多个新任务。</p>
            
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">执行次数（倍率）</label>
              <div className="flex gap-2">
                {[1, 2, 3, 5, 10].map(n => (
                  <button
                    key={n}
                    onClick={() => setRerunMultiplier(n)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      rerunMultiplier === n 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {n}x
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                max="20"
                value={rerunMultiplier}
                onChange={e => setRerunMultiplier(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                className="mt-2 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                placeholder="或输入自定义次数（最大20）"
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowRerunModal(false)}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleRerun}
                disabled={rerunning}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {rerunning ? '执行中...' : `执行 ${rerunMultiplier} 次`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
