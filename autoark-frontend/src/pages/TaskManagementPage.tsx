import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

const API_BASE = '/api'

interface TaskItem {
  accountId: string
  accountName: string
  status: string
  progress: { current: number; total: number; percentage: number }
  result?: { campaignId?: string; adsetIds?: string[]; adIds?: string[]; createdCount?: number }
  errors?: Array<{ entityType: string; errorMessage: string }>
  startedAt?: string
  completedAt?: string
}

interface Task {
  _id: string
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
  createdAt: string
  startedAt?: string
  completedAt?: string
  duration?: number
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: '等待中', color: 'bg-slate-100 text-slate-600' },
  queued: { label: '排队中', color: 'bg-yellow-100 text-yellow-600' },
  processing: { label: '执行中', color: 'bg-blue-100 text-blue-600' },
  success: { label: '成功', color: 'bg-green-100 text-green-600' },
  partial_success: { label: '部分成功', color: 'bg-orange-100 text-orange-600' },
  failed: { label: '失败', color: 'bg-red-100 text-red-600' },
  cancelled: { label: '已取消', color: 'bg-slate-100 text-slate-600' },
}

export default function TaskManagementPage() {
  const [searchParams] = useSearchParams()
  const taskIdFromUrl = searchParams.get('taskId')
  
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  
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
      const res = await fetch(`${API_BASE}/bulk-ad/tasks`)
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
      const res = await fetch(`${API_BASE}/bulk-ad/tasks/${taskId}`)
      const data = await res.json()
      if (data.success) {
        setSelectedTask(data.data)
        // Update in list too
        setTasks(tasks.map(t => t._id === taskId ? data.data : t))
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
      const res = await fetch(`${API_BASE}/bulk-ad/tasks/${taskId}/cancel`, { method: 'POST' })
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
      const res = await fetch(`${API_BASE}/bulk-ad/tasks/${taskId}/retry`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        loadTasks()
        if (selectedTask?._id === taskId) loadTaskDetail(taskId)
      }
    } catch (err) {
      console.error('Failed to retry task:', err)
    }
  }
  
  const handleRerun = async (taskId: string) => {
    if (!confirm('确定要重新执行此任务吗？将基于原任务配置创建新任务。')) return
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/tasks/${taskId}/rerun`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        alert(`新任务已创建：${data.data._id}`)
        loadTasks()
        // 选中新任务
        setSelectedTask(data.data)
      } else {
        alert(`重新执行失败：${data.error}`)
      }
    } catch (err) {
      console.error('Failed to rerun task:', err)
      alert('重新执行失败')
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
    return <div className="p-6 flex justify-center items-center h-64"><div className="text-slate-500">加载中...</div></div>
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
                    <div className="text-sm font-medium text-slate-700 truncate">任务 #{task._id.slice(-6)}</div>
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
                    <h2 className="font-semibold">任务详情</h2>
                    <span className="text-xs text-slate-500">ID: {selectedTask._id}</span>
                  </div>
                  <div className="flex gap-2">
                    {['pending', 'queued', 'processing'].includes(selectedTask.status) && (
                      <button onClick={() => handleCancel(selectedTask._id)} className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50">取消任务</button>
                    )}
                    {['failed', 'partial_success'].includes(selectedTask.status) && (
                      <button onClick={() => handleRetry(selectedTask._id)} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">重试失败项</button>
                    )}
                    {['success', 'failed', 'partial_success', 'cancelled'].includes(selectedTask.status) && (
                      <button onClick={() => handleRerun(selectedTask._id)} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700">重新执行</button>
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
                
                <div className="p-4 border-b border-slate-200 grid grid-cols-3 gap-4 text-sm">
                  <div><span className="text-slate-500">状态：</span><span className={`px-2 py-0.5 rounded ${STATUS_MAP[selectedTask.status]?.color}`}>{STATUS_MAP[selectedTask.status]?.label}</span></div>
                  <div><span className="text-slate-500">开始时间：</span>{formatTime(selectedTask.startedAt)}</div>
                  <div><span className="text-slate-500">耗时：</span>{formatDuration(selectedTask.duration)}</div>
                </div>
                
                <div className="p-4">
                  <h3 className="font-semibold mb-3">账户执行详情</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {selectedTask.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${item.status === 'success' ? 'bg-green-500' : item.status === 'failed' ? 'bg-red-500' : item.status === 'processing' ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`} />
                          <div>
                            <div className="font-medium text-sm">{item.accountName || item.accountId}</div>
                            <div className="text-xs text-slate-500">{item.accountId}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-xs px-2 py-0.5 rounded ${STATUS_MAP[item.status]?.color || 'bg-slate-100'}`}>{STATUS_MAP[item.status]?.label || item.status}</span>
                          {item.result?.createdCount !== undefined && <div className="text-xs text-slate-500 mt-1">创建 {item.result.createdCount} 个广告</div>}
                          {item.errors && item.errors.length > 0 && (
                            <div className="text-xs text-red-500 mt-1 max-w-xs truncate" title={item.errors[0].errorMessage}>{item.errors[0].errorMessage}</div>
                          )}
                        </div>
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
    </div>
  )
}

