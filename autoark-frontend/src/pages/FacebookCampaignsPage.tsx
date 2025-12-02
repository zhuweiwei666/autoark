import { useState, useEffect, useMemo } from 'react'
import DatePicker from '../components/DatePicker'

// 获取今天的日期字符串 (YYYY-MM-DD)
const getToday = () => {
  const today = new Date()
  return today.toISOString().split('T')[0]
}
import {
  getCampaigns,
  syncCampaigns,
  getCampaignColumnSettings,
  saveCampaignColumnSettings,
  type FbCampaign,
} from '../services/api'
// Removed: import { Checkbox } from '../components/ui/checkbox'
// Removed: import { Button } from '../components/ui/button'
// Removed: import { Input } from '../components/ui/input'
// Removed: import { Select } from '../components/ui/select'
// Removed: import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog'

// 格式化函数 - 确保类型安全
const formatCurrency = (v: any) => {
  if (v === null || v === undefined || v === '') return '-'
  const num = typeof v === 'number' ? v : parseFloat(v)
  return !isNaN(num) ? `$${num.toFixed(2)}` : '-'
}
const formatPercent = (v: any) => {
  if (v === null || v === undefined || v === '') return '-'
  const num = typeof v === 'number' ? v : parseFloat(v)
  return !isNaN(num) ? `${(num * 100).toFixed(2)}%` : '-'
}
const formatNumber = (v: any) => {
  if (v === null || v === undefined || v === '') return '-'
  const num = typeof v === 'number' ? v : parseFloat(v)
  return !isNaN(num) ? num.toLocaleString() : '-'
}
const formatDate = (v: any) => {
  if (!v) return '-'
  try {
    const date = new Date(v)
    return isNaN(date.getTime()) ? v : date.toLocaleString()
  } catch {
    return v
  }
}
const formatBudget = (v: any) => {
  if (v === null || v === undefined || v === '') return '-'
  const num = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : parseFloat(v))
  return !isNaN(num) && num > 0 ? `$${(num / 100).toFixed(2)}` : '-'
}

// 默认列定义 - 使用 Facebook API 原始字段名
const ALL_CAMPAIGN_COLUMNS = [
  // Campaign 基础字段
  { key: 'id', label: 'id', defaultVisible: false, format: (v: any) => v || '-' },
  { key: 'name', label: 'name', defaultVisible: true, format: (v: any) => v || '-' },
  { key: 'account_id', label: 'account_id', defaultVisible: true, format: (v: any) => v || '-' },
  { key: 'status', label: 'status', defaultVisible: true, format: (v: any) => v ? String(v).toUpperCase() : '-' },
  { key: 'objective', label: 'objective', defaultVisible: false, format: (v: any) => v || '-' },
  { key: 'buying_type', label: 'buying_type', defaultVisible: false, format: (v: any) => v || '-' },
  { key: 'daily_budget', label: 'daily_budget', defaultVisible: false, format: formatBudget },
  { key: 'budget_remaining', label: 'budget_remaining', defaultVisible: false, format: formatBudget },
  { key: 'lifetime_budget', label: 'lifetime_budget', defaultVisible: false, format: formatBudget },
  { key: 'start_time', label: 'start_time', defaultVisible: false, format: formatDate },
  { key: 'stop_time', label: 'stop_time', defaultVisible: false, format: formatDate },
  { key: 'created_time', label: 'created_time', defaultVisible: false, format: formatDate },
  { key: 'updated_time', label: 'updated_time', defaultVisible: false, format: formatDate },
  { key: 'bid_strategy', label: 'bid_strategy', defaultVisible: false, format: (v: any) => v || '-' },
  { key: 'bid_amount', label: 'bid_amount', defaultVisible: false, format: formatCurrency },
  { key: 'source_campaign_id', label: 'source_campaign_id', defaultVisible: false, format: (v: any) => v || '-' },
  
  // Insights 基础指标
  { key: 'impressions', label: 'impressions', defaultVisible: true, format: formatNumber },
  { key: 'clicks', label: 'clicks', defaultVisible: true, format: formatNumber },
  { key: 'unique_clicks', label: 'unique_clicks', defaultVisible: false, format: formatNumber },
  { key: 'spend', label: 'spend', defaultVisible: true, format: formatCurrency },
  { key: 'reach', label: 'reach', defaultVisible: false, format: formatNumber },
  { key: 'frequency', label: 'frequency', defaultVisible: false, format: (v: any) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = typeof v === 'number' ? v : parseFloat(v)
    return !isNaN(num) ? num.toFixed(2) : '-'
  }},
  
  // Insights 成本指标
  { key: 'cpc', label: 'cpc', defaultVisible: true, format: formatCurrency },
  { key: 'cpm', label: 'cpm', defaultVisible: true, format: formatCurrency },
  { key: 'cpp', label: 'cpp', defaultVisible: false, format: formatCurrency },
  { key: 'cpa', label: 'cpa', defaultVisible: false, format: formatCurrency },
  { key: 'ctr', label: 'ctr', defaultVisible: true, format: formatPercent },
  { key: 'cost_per_conversion', label: 'cost_per_conversion', defaultVisible: false, format: formatCurrency },
  { key: 'conversion_rate', label: 'conversion_rate', defaultVisible: false, format: formatPercent },
  
  // Insights 转化指标
  { key: 'conversions', label: 'conversions', defaultVisible: false, format: formatNumber },
  { key: 'value', label: 'value', defaultVisible: false, format: formatCurrency },
  
  // Insights 视频指标
  { key: 'video_play_actions', label: 'video_play_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_30_sec_watched_actions', label: 'video_30_sec_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_avg_time_watched_actions', label: 'video_avg_time_watched_actions', defaultVisible: false, format: (v: any) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = typeof v === 'number' ? v : parseFloat(v)
    return !isNaN(num) ? `${num.toFixed(2)}s` : '-'
  }},
  { key: 'video_p100_watched_actions', label: 'video_p100_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_p25_watched_actions', label: 'video_p25_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_p50_watched_actions', label: 'video_p50_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_p75_watched_actions', label: 'video_p75_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_p95_watched_actions', label: 'video_p95_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_thruplay_watched_actions', label: 'video_thruplay_watched_actions', defaultVisible: false, format: formatNumber },
  { key: 'video_time_watched_actions', label: 'video_time_watched_actions', defaultVisible: false, format: (v: any) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = typeof v === 'number' ? v : parseFloat(v)
    return !isNaN(num) ? `${num.toFixed(2)}s` : '-'
  }},
  
  // Actions - 常见操作类型（动态字段，从 actions 数组中提取）
  { key: 'mobile_app_install', label: 'mobile_app_install', defaultVisible: true, format: formatNumber },
  { key: 'link_click', label: 'link_click', defaultVisible: false, format: formatNumber },
  { key: 'page_engagement', label: 'page_engagement', defaultVisible: false, format: formatNumber },
  { key: 'post_engagement', label: 'post_engagement', defaultVisible: false, format: formatNumber },
  { key: 'post', label: 'post', defaultVisible: false, format: formatNumber },
  { key: 'post_reaction', label: 'post_reaction', defaultVisible: false, format: formatNumber },
  { key: 'comment', label: 'comment', defaultVisible: false, format: formatNumber },
  { key: 'like', label: 'like', defaultVisible: false, format: formatNumber },
  { key: 'share', label: 'share', defaultVisible: false, format: formatNumber },
  { key: 'video_view', label: 'video_view', defaultVisible: false, format: formatNumber },
  { key: 'lead', label: 'lead', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_purchase', label: 'offsite_conversion.fb_pixel_purchase', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_add_to_cart', label: 'offsite_conversion.fb_pixel_add_to_cart', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_initiate_checkout', label: 'offsite_conversion.fb_pixel_initiate_checkout', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_search', label: 'offsite_conversion.fb_pixel_search', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_view_content', label: 'offsite_conversion.fb_pixel_view_content', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_add_payment_info', label: 'offsite_conversion.fb_pixel_add_payment_info', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_complete_registration', label: 'offsite_conversion.fb_pixel_complete_registration', defaultVisible: false, format: formatNumber },
  { key: 'offsite_conversion.fb_pixel_lead', label: 'offsite_conversion.fb_pixel_lead', defaultVisible: false, format: formatNumber },
  
  // Action Values - 常见操作价值（动态字段，从 action_values 数组中提取）
  { key: 'purchase_value', label: 'purchase_value', defaultVisible: false, format: formatCurrency },
  { key: 'mobile_app_purchase_value', label: 'mobile_app_purchase_value', defaultVisible: false, format: formatCurrency },
  { key: 'offsite_conversion.fb_pixel_purchase_value', label: 'offsite_conversion.fb_pixel_purchase_value', defaultVisible: false, format: formatCurrency },
  { key: 'offsite_conversion.fb_pixel_add_to_cart_value', label: 'offsite_conversion.fb_pixel_add_to_cart_value', defaultVisible: false, format: formatCurrency },
  { key: 'offsite_conversion.fb_pixel_initiate_checkout_value', label: 'offsite_conversion.fb_pixel_initiate_checkout_value', defaultVisible: false, format: formatCurrency },
  { key: 'offsite_conversion.fb_pixel_lead_value', label: 'offsite_conversion.fb_pixel_lead_value', defaultVisible: false, format: formatCurrency },
  
  // Purchase ROAS - 购买 ROAS（动态字段，从 purchase_roas 数组中提取）
  { key: 'purchase_roas', label: 'purchase_roas', defaultVisible: false, format: (v: any) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = typeof v === 'number' ? v : parseFloat(v)
    return !isNaN(num) ? num.toFixed(2) : '-'
  }},
  { key: 'mobile_app_purchase_roas', label: 'mobile_app_purchase_roas', defaultVisible: false, format: (v: any) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = typeof v === 'number' ? v : parseFloat(v)
    return !isNaN(num) ? num.toFixed(2) : '-'
  }},
  { key: 'offsite_conversion.fb_pixel_purchase_roas', label: 'offsite_conversion.fb_pixel_purchase_roas', defaultVisible: false, format: (v: any) => {
    if (v === null || v === undefined || v === '') return '-'
    const num = typeof v === 'number' ? v : parseFloat(v)
    return !isNaN(num) ? num.toFixed(2) : '-'
  }},
  
  // 时间字段
  { key: 'date_start', label: 'date_start', defaultVisible: false, format: (v: string) => v || '-' },
  { key: 'date_stop', label: 'date_stop', defaultVisible: false, format: (v: string) => v || '-' },
]

export default function FacebookCampaignsPage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> } | null>(null)

  // 列表数据
  const [campaigns, setCampaigns] = useState<FbCampaign[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  })
  
  // 排序状态 - 默认按 spend 降序
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({ key: 'spend', direction: 'desc' })

  // 筛选条件 - 默认显示今天的数据
  const today = getToday()
  const [filters, setFilters] = useState({
    name: '',
    accountId: '',
    status: '',
    objective: '',
    startDate: today,
    endDate: today,
  })

  // 自定义列相关
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])
  const [columnOrder, setColumnOrder] = useState<string[]>([]) // 列的顺序（包括所有列）
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [columnSearchQuery, setColumnSearchQuery] = useState<string>('') // 搜索关键词

  // 字段名映射（兼容旧数据）
  const fieldNameMapping: Record<string, string> = {
    'accountId': 'account_id',
    'installs': 'mobile_app_install',
    'event_conversions': 'conversions',
    'purchase_value': 'purchase_value', // 保持不变，但需要从 action_values 中提取
    'roas': 'purchase_roas', // 需要从 purchase_roas 中提取
    'cpi': 'mobile_app_install', // CPI 需要计算，暂时用 mobile_app_install
  }

  // 获取用户自定义列设置
  const loadColumnSettings = async () => {
    try {
      const response = await getCampaignColumnSettings()
      if (response.data && response.data.length > 0) {
        // 映射旧字段名到新字段名
        const mappedColumns = response.data.map((col: string) => fieldNameMapping[col] || col)
        
        // 确保默认可见列在可见列中
        const defaultVisibleKeys = ALL_CAMPAIGN_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
        const userColumns = [...mappedColumns]
        
        // 如果用户设置中没有 mobile_app_install，但它是默认可见的，则添加它
        if (!userColumns.includes('mobile_app_install') && defaultVisibleKeys.includes('mobile_app_install')) {
          // 找到应该插入的位置（在 cpc 之后）
          const cpcIndex = userColumns.indexOf('cpc')
          if (cpcIndex >= 0) {
            userColumns.splice(cpcIndex + 1, 0, 'mobile_app_install')
          } else {
            userColumns.push('mobile_app_install')
          }
        }
        
        setVisibleColumns(userColumns)
        // 如果返回的数据包含顺序信息，使用它；否则使用默认顺序
        const allColumnKeys = ALL_CAMPAIGN_COLUMNS.map(col => col.key)
        // 保持可见列的顺序，并将不可见列追加到后面
        const orderedColumns = [
          ...userColumns,
          ...allColumnKeys.filter(key => !userColumns.includes(key))
        ]
        setColumnOrder(orderedColumns)
      } else {
        // 默认显示部分列
        const defaultVisible = ALL_CAMPAIGN_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
        // 确保 mobile_app_install 在默认可见列中
        if (!defaultVisible.includes('mobile_app_install')) {
          defaultVisible.push('mobile_app_install')
        }
        setVisibleColumns(defaultVisible)
        setColumnOrder(ALL_CAMPAIGN_COLUMNS.map(col => col.key))
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载列设置失败' })
      const defaultVisible = ALL_CAMPAIGN_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
      setVisibleColumns(defaultVisible)
      setColumnOrder(ALL_CAMPAIGN_COLUMNS.map(col => col.key))
    }
  }

  // 保存用户自定义列设置
  const saveColumnSettings = async (columns: string[], order?: string[]) => {
    try {
      // 保存可见列和顺序
      const columnsToSave = order || columnOrder.filter(key => columns.includes(key))
      await saveCampaignColumnSettings(columnsToSave)
      setMessage({ type: 'success', text: '列设置已保存！' })
      setVisibleColumns(columns)
      if (order) {
        setColumnOrder(order)
      }
      setShowColumnSettings(false)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '保存列设置失败' })
    }
  }

  // 拖拽处理函数
  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null) return
    
    const newOrder = [...columnOrder]
    const draggedItem = newOrder[draggedIndex]
    newOrder.splice(draggedIndex, 1)
    newOrder.splice(index, 0, draggedItem)
    setColumnOrder(newOrder)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  // 加载广告系列列表
  const loadCampaigns = async (page = 1) => {
    setLoading(true)
    try {
      const response = await getCampaigns({
        page,
        limit: pagination.limit,
        ...filters,
        // sortBy: 'spend', // 示例排序
        // sortOrder: 'desc',
      })
      setCampaigns(response.data)
      setPagination(response.pagination)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '加载失败' })
    } finally {
      setLoading(false)
    }
  }

  // 初始加载数据和列设置
  useEffect(() => {
    loadCampaigns()
    loadColumnSettings()
  }, [])

  // 优化：使用防抖，避免筛选时频繁请求
  useEffect(() => {
    // 跳过初始加载（初始加载由上面的 useEffect 处理）
    const hasFilters = filters.name || filters.accountId || filters.status || filters.objective || filters.startDate || filters.endDate
    if (!hasFilters) return

    const timeoutId = setTimeout(() => {
      loadCampaigns(1) // 筛选时重置到第一页
    }, 500) // 500ms 防抖

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.name, filters.accountId, filters.status, filters.objective, filters.startDate, filters.endDate])

  // 执行同步
  const handleSync = async () => {
    setSyncing(true)
    setMessage(null)
    try {
      const result = await syncCampaigns()
      setMessage({ 
        type: 'success', 
        text: `同步完成！成功: ${result.data.syncedCampaigns}个广告系列, ${result.data.syncedMetrics}个指标, 失败: ${result.data.errorCount}个`,
        errors: result.data.errors || [],
      })
      loadCampaigns(1) // 刷新列表
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '同步失败' })
    } finally {
      setSyncing(false)
    }
  }

  // 状态颜色映射
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
      case 'PAUSED':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'ARCHIVED':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
      case 'DELETED':
        return 'bg-red-500/10 text-red-400 border-red-500/20'
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
    }
  }

  // 根据可见列和顺序过滤 - 使用 useMemo 缓存，避免频繁重新计算
  const columnsToRender = useMemo(() => {
    // 如果 columnOrder 为空，使用默认顺序
    const order = columnOrder.length > 0 ? columnOrder : ALL_CAMPAIGN_COLUMNS.map(col => col.key)
    
    // 如果 visibleColumns 为空，使用默认可见列
    const visible = visibleColumns.length > 0 ? visibleColumns : ALL_CAMPAIGN_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
    
    // 按照 columnOrder 的顺序，只包含可见的列
    return order
      .filter(key => visible.includes(key))
      .map(key => ALL_CAMPAIGN_COLUMNS.find(col => col.key === key))
      .filter((col): col is typeof ALL_CAMPAIGN_COLUMNS[0] => col !== undefined)
  }, [visibleColumns, columnOrder])

  // 错误处理：如果 columnsToRender 为空，使用默认列 - 也使用 useMemo
  const safeColumnsToRender = useMemo(() => {
    return columnsToRender.length > 0 
      ? columnsToRender 
      : ALL_CAMPAIGN_COLUMNS.filter(col => col.defaultVisible)
  }, [columnsToRender])

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-200 p-6 relative overflow-hidden">
      {/* 背景光效 */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[150px]" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto space-y-8">
        {/* 头部 */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-white tracking-tight">广告系列管理</h1>
            <span className="bg-slate-800/50 border border-slate-700/50 px-3 py-1 rounded-full text-xs font-medium text-slate-400 backdrop-blur-sm">
              Total: {pagination.total}
            </span>
          </div>
          <div className="flex gap-4">
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`group px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-xl text-sm font-semibold text-white shadow-lg shadow-blue-900/20 hover:shadow-blue-900/40 transition-all duration-300 flex items-center gap-2 transform hover:-translate-y-0.5 ${syncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <svg className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? '同步中...' : '同步广告系列'}
            </button>

            {/* 自定义列设置按钮 (使用原生 HTML 按钮和手动 Modal 逻辑) */}
            <button
              onClick={() => setShowColumnSettings(true)}
              className="px-5 py-2.5 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 rounded-xl text-sm font-medium text-slate-300 transition-colors backdrop-blur-sm hover:border-slate-600 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                自定义列
            </button>

              {/* 自定义列设置弹窗 */}
              {showColumnSettings && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in">
                  <div 
                    className="absolute inset-0" 
                    onClick={() => setShowColumnSettings(false)}
                  ></div>
                  <div className="bg-[#0f172a] border border-slate-700/50 rounded-2xl p-8 w-full max-w-xl shadow-2xl shadow-blue-900/20 relative z-10 transform transition-all scale-100">
                    <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                        <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2.5 rounded-xl text-white shadow-lg shadow-blue-500/20">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </div>
                        自定义列
                    </h2>
                    
                    {/* 搜索框 */}
                    <div className="mb-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={columnSearchQuery}
                                onChange={(e) => setColumnSearchQuery(e.target.value)}
                                placeholder="搜索字段名..."
                                className="w-full px-4 py-2.5 pl-10 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            {columnSearchQuery && (
                                <button
                                    onClick={() => setColumnSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-4 text-sm text-slate-400">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        <span>💡 拖拽列标题可以调整顺序</span>
                    </div>
                    
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                      {/* 过滤列列表 */}
                      {(() => {
                        const allColumns = columnOrder.length > 0 ? columnOrder : ALL_CAMPAIGN_COLUMNS.map(col => col.key)
                        const filteredColumns = columnSearchQuery
                          ? allColumns.filter(colKey => {
                              const col = ALL_CAMPAIGN_COLUMNS.find(c => c.key === colKey)
                              if (!col) return false
                              const searchLower = columnSearchQuery.toLowerCase()
                              return col.key.toLowerCase().includes(searchLower) || col.label.toLowerCase().includes(searchLower)
                            })
                          : allColumns
                        
                        return filteredColumns.length === 0 ? (
                          <div className="text-center py-8 text-slate-500 text-sm">
                            未找到匹配的字段
                          </div>
                        ) : (
                          filteredColumns.map((colKey) => {
                            const col = ALL_CAMPAIGN_COLUMNS.find(c => c.key === colKey)
                            if (!col) return null
                            // 使用当前 columnOrder 或默认顺序
                            const currentOrder = columnOrder.length > 0 ? columnOrder : ALL_CAMPAIGN_COLUMNS.map(c => c.key)
                            const actualIndex = currentOrder.indexOf(colKey)
                            
                            return (
                              <div
                                key={col.key}
                                draggable={!columnSearchQuery} // 搜索时禁用拖拽
                                onDragStart={() => handleDragStart(actualIndex)}
                                onDragOver={(e) => handleDragOver(e, actualIndex)}
                                onDragEnd={handleDragEnd}
                                className={`flex items-center space-x-3 p-3 rounded-lg border transition-all ${
                                  columnSearchQuery ? 'cursor-default' : 'cursor-move'
                                } ${
                                  draggedIndex === actualIndex
                                    ? 'bg-indigo-500/20 border-indigo-500/50 shadow-lg'
                                    : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-700/50'
                                }`}
                              >
                            {/* 拖拽手柄 */}
                            <div className="flex items-center text-slate-400 hover:text-slate-300">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
                              </svg>
                            </div>
                            <input
                              type="checkbox"
                              id={`col-${col.key}`}
                              checked={visibleColumns.includes(col.key)}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                setVisibleColumns(prev =>
                                  e.target.checked ? [...prev, col.key] : prev.filter(k => k !== col.key)
                                )
                              }}
                              className="form-checkbox h-4 w-4 text-indigo-600 bg-slate-800 border-slate-600 rounded focus:ring-indigo-500"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <label
                              htmlFor={`col-${col.key}`}
                              className="flex-1 text-sm font-medium leading-none text-slate-300 cursor-pointer"
                            >
                              {col.label}
                            </label>
                          </div>
                            )
                          })
                        )
                      })()}
                    </div>
                    <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-800/50">
                      <button onClick={() => {
                        setShowColumnSettings(false)
                        setColumnSearchQuery('') // 关闭时清空搜索
                      }} className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 font-medium">
                        取消
                      </button>
                      <button onClick={() => {
                        saveColumnSettings(visibleColumns, columnOrder)
                        setColumnSearchQuery('') // 保存时清空搜索
                      }} className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-xl text-white font-medium">
                        保存设置
                      </button>
                    </div>
                  </div>
          </div>
              )}
            </div> {/* This div closes the header items flex container */}
        </header>

        {/* 消息提示 */}
        {message && (
          <div className={`p-4 rounded-xl border backdrop-blur-md shadow-lg animate-fade-in ${
            message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
              {message.type === 'success' ? (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
              ) : (
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              )}
              <span className="font-medium">{message.text}</span>
            </div>
                {message.errors && message.errors.length > 0 && (
                  <div className="mt-3 pl-8 space-y-2">
                    <div className="text-sm opacity-90">
                      <strong>失败详情：</strong>
                    </div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {message.errors.slice(0, 5).map((err, idx) => (
                        <div key={idx} className="text-xs opacity-80 pl-2 border-l-2 border-amber-500/30">
                          {err.accountId && <span className="font-mono">账户: {err.accountId}</span>}
                          {err.tokenId && <span className="font-mono">Token: {err.tokenId.substring(0, 8)}...</span>}
                          {err.optimizer && <span className="ml-2">优化师: {err.optimizer}</span>}
                          <div className="mt-1 text-amber-300/80">{err.error}</div>
                        </div>
                      ))}
                      {message.errors.length > 5 && (
                        <div className="text-xs opacity-70 italic pl-2">
                          还有 {message.errors.length - 5} 个错误...
                        </div>
                      )}
                    </div>
                    <a
                      href="/dashboard"
                      className="inline-flex items-center gap-2 mt-2 text-sm text-blue-400 hover:text-blue-300 underline transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      前往日志中心查看完整日志
                    </a>
                  </div>
                )}
              </div>
              <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100 p-1 hover:bg-white/5 rounded-lg transition-all flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            </div>
          </div>
        )}

        {/* 筛选区域 */}
        <section className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
             <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
               <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
               筛选条件
             </h2>
             {(filters.name || filters.accountId || filters.status || filters.objective || filters.startDate || filters.endDate) && (
                 <button 
                   onClick={() => setFilters({ name: '', accountId: '', status: '', objective: '', startDate: '', endDate: '' })} 
                    className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
                 >
                    重置筛选
                 </button>
             )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 items-end">
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">开始日期</label>
              <DatePicker
                value={filters.startDate}
                onChange={(date) => setFilters({...filters, startDate: date})}
                placeholder="选择开始日期"
                className="w-full"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">结束日期</label>
              <DatePicker
                value={filters.endDate}
                onChange={(date) => setFilters({...filters, endDate: date})}
                placeholder="选择结束日期"
                className="w-full"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">广告系列名称</label>
              <input
                type="text"
                value={filters.name}
                onChange={e => setFilters({...filters, name: e.target.value})}
                placeholder="输入名称"
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">账户ID</label>
              <input
                type="text"
                value={filters.accountId}
                onChange={e => setFilters({...filters, accountId: e.target.value})}
                placeholder="输入账户ID"
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">状态</label>
              <div className="relative">
                <select
                  value={filters.status}
                  onChange={e => setFilters({...filters, status: e.target.value})}
                  className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all appearance-none cursor-pointer"
                >
                  <option value="">全部状态</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PAUSED">PAUSED</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                  <option value="DELETED">DELETED</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>
            <div className="group">
              <label className="block text-xs font-medium text-slate-400 mb-2 group-focus-within:text-indigo-400 transition-colors">目标</label>
              <input
                type="text"
                value={filters.objective}
                onChange={e => setFilters({...filters, objective: e.target.value})}
                placeholder="输入目标 (如 LEAD_GENERATION)"
                className="w-full px-4 py-2.5 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <div>
               <button
                 onClick={() => loadCampaigns(1)}
                 className="w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-medium transition-all hover:shadow-lg border border-transparent hover:border-slate-500"
               >
                 执行筛选
               </button>
            </div>
          </div>
        </section>

        {/* 广告系列列表 */}
        <section className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/5 bg-white/5">
                  {safeColumnsToRender.map(col => (
                    <th 
                      key={col.key} 
                      className="px-6 py-5 font-semibold text-slate-300 cursor-pointer hover:bg-white/10 transition-colors select-none"
                      onClick={() => {
                        const direction = sortConfig?.key === col.key && sortConfig.direction === 'asc' ? 'desc' : 'asc'
                        setSortConfig({ key: col.key, direction })
                      }}
                      >
                        <div className="flex items-center gap-2">
                        <span>{col.label}</span>
                        {sortConfig?.key === col.key && (
                          <svg className={`w-4 h-4 ${sortConfig.direction === 'asc' ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" />
                          </svg>
                        )}
                        {sortConfig?.key !== col.key && (
                          <svg className="w-4 h-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                          </svg>
                          )}
                        </div>
                      </th>
                  ))}
                  <th className="px-6 py-5 font-semibold text-slate-300 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr><td colSpan={safeColumnsToRender.length + 1} className="px-6 py-12 text-center text-slate-500 animate-pulse">加载中...</td></tr>
                ) : campaigns.length === 0 ? (
                  <tr><td colSpan={safeColumnsToRender.length + 1} className="px-6 py-12 text-center text-slate-500">暂无数据</td></tr>
                ) : (
                  (() => {
                    // 排序逻辑
                    const sortedCampaigns = [...campaigns]
                    if (sortConfig) {
                      sortedCampaigns.sort((a, b) => {
                        const aVal = (a as any)[sortConfig.key]
                        const bVal = (b as any)[sortConfig.key]
                        if (aVal === null || aVal === undefined) return 1
                        if (bVal === null || bVal === undefined) return -1
                        if (typeof aVal === 'number' && typeof bVal === 'number') {
                          return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal
                        }
                        const aStr = String(aVal).toLowerCase()
                        const bStr = String(bVal).toLowerCase()
                        if (sortConfig.direction === 'asc') {
                          return aStr.localeCompare(bStr)
                        } else {
                          return bStr.localeCompare(aStr)
                        }
                      })
                    }
                    return sortedCampaigns.map((campaign) => (
                    <tr key={campaign.id || (campaign as any).id} className="group hover:bg-white/[0.02] transition-colors">
                      {safeColumnsToRender.map(col => (
                        <td key={col.key} className="px-6 py-4">
                          {col.key === 'name' ? (
                            <div>
                              <div className="font-medium text-slate-200 group-hover:text-indigo-300 transition-colors">{(col.format as (v: string) => string)(campaign.name || (campaign as any).name)}</div>
                              <div className="text-xs text-slate-500 font-mono mt-1 opacity-70">ID: {(col.format as (v: string) => string)(campaign.campaignId || (campaign as any).id)}</div>
                                </div>
                          ) : col.key === 'status' ? (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(campaign.status || (campaign as any).status)}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 bg-current opacity-70`}></span>
                              {(col.format as (v: string) => string)(campaign.status || (campaign as any).status)}
                                </span>
                          ) : col.key === 'account_id' || col.key === 'accountId' ? (
                            <div className="text-xs text-slate-400 font-mono">{(campaign as any)[col.key] || campaign.accountId || '-'}</div>
                          ) : (
                            <span className="text-slate-300">{(campaign as any)[col.key] !== undefined && (campaign as any)[col.key] !== null ? col.format((campaign as any)[col.key]) : '-'}</span>
                          )}
                          </td>
                      ))}
                      <td className="px-6 py-4 text-right">
                        <button className="text-slate-400 hover:text-indigo-400 transition-colors opacity-60 group-hover:opacity-100">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                  })()
                )}
              </tbody>
            </table>
          </div>
          
          {/* 分页 */}
          {pagination.pages > 1 && (
            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                显示 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 共 {pagination.total} 条
              </span>
              <div className="flex gap-2">
                <button
                  disabled={pagination.page === 1}
                  onClick={() => loadCampaigns(pagination.page - 1)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-xs text-slate-300"
                >
                  上一页
                </button>
                <button
                  disabled={pagination.page === pagination.pages}
                  onClick={() => loadCampaigns(pagination.page + 1)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded text-xs text-slate-300"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
