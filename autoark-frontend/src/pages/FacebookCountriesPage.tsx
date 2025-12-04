import { useState, useEffect, useMemo } from 'react'
import DatePicker from '../components/DatePicker'

// 获取今天的日期字符串 (YYYY-MM-DD)
const getToday = () => {
  const today = new Date()
  return today.toISOString().split('T')[0]
}
import {
  getCountries,
  syncCampaigns,
  getCampaignColumnSettings,
  saveCampaignColumnSettings,
  type FbCountry,
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

// 默认列定义 - 国家页面
const ALL_COUNTRY_COLUMNS = [
  // 国家基础字段 - 国家必须是第一列
  { key: 'country', label: '国家代码', defaultVisible: true, format: (v: any) => v || '-' },
  { key: 'countryName', label: '国家名称', defaultVisible: true, format: (v: any) => v || '-' },
  { key: 'spend', label: 'spend', defaultVisible: true, format: formatCurrency },
  { key: 'campaignCount', label: '广告系列数', defaultVisible: true, format: formatNumber },
  { key: 'status', label: 'status', defaultVisible: false, format: (v: any) => v ? String(v).toUpperCase() : '-' },
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
  { key: 'source_country_id', label: 'source_country_id', defaultVisible: false, format: (v: any) => v || '-' },
  
  // Insights 基础指标
  { key: 'impressions', label: 'impressions', defaultVisible: true, format: formatNumber },
  { key: 'clicks', label: 'clicks', defaultVisible: true, format: formatNumber },
  { key: 'unique_clicks', label: 'unique_clicks', defaultVisible: false, format: formatNumber },
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

export default function FacebookCountriesPage() {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; errors?: Array<{ accountId?: string; tokenId?: string; optimizer?: string; error: string }> } | null>(null)

  // 列表数据
  const [countries, setCountries] = useState<FbCountry[]>([])
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
        const defaultVisibleKeys = ALL_COUNTRY_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
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
        const allColumnKeys = ALL_COUNTRY_COLUMNS.map(col => col.key)
        // 保持可见列的顺序，并将不可见列追加到后面
        const orderedColumns = [
          ...userColumns,
          ...allColumnKeys.filter(key => !userColumns.includes(key))
        ]
        setColumnOrder(orderedColumns)
      } else {
        // 默认显示部分列
        const defaultVisible = ALL_COUNTRY_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
        // 确保 mobile_app_install 在默认可见列中
        if (!defaultVisible.includes('mobile_app_install')) {
          defaultVisible.push('mobile_app_install')
        }
        setVisibleColumns(defaultVisible)
        setColumnOrder(ALL_COUNTRY_COLUMNS.map(col => col.key))
      }
    } catch (error: any) {
      // 静默处理错误，避免显示 HTML 解析错误（列设置是可选的）
      console.warn('Failed to load column settings:', error.message)
      const defaultVisible = ALL_COUNTRY_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
      setVisibleColumns(defaultVisible)
      setColumnOrder(ALL_COUNTRY_COLUMNS.map(col => col.key))
      // 不设置错误消息，因为这是可选的设置，失败时使用默认设置即可
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

  // 缓存 key
  const getCacheKey = () => `fb-countries-${JSON.stringify(filters)}-${sortConfig?.key}-${sortConfig?.direction}`
  
  // 加载国家列表（支持缓存优先）
  const loadCountries = async (page = 1, forceRefresh = false) => {
    // 如果不是强制刷新，先尝试从缓存加载
    if (!forceRefresh) {
      const cachedData = localStorage.getItem(getCacheKey())
      if (cachedData) {
        try {
          const { data, pagination: cachedPagination, timestamp } = JSON.parse(cachedData)
          // 缓存 5 分钟内有效
          if (Date.now() - timestamp < 5 * 60 * 1000) {
            setCountries(data)
            setPagination(cachedPagination)
            return // 使用缓存数据，不请求 API
          }
        } catch (e) {
          // 缓存解析失败，继续请求 API
        }
      }
    }
    
    setLoading(true)
    try {
      const response = await getCountries({
        page,
        limit: pagination.limit,
        ...filters,
        sortBy: sortConfig?.key || 'spend',
        sortOrder: sortConfig?.direction || 'desc',
      })
      setCountries(response.data)
      setPagination(response.pagination)
      
      // 保存到缓存
      localStorage.setItem(getCacheKey(), JSON.stringify({
        data: response.data,
        pagination: response.pagination,
        timestamp: Date.now()
      }))
      
      // 如果加载成功，清除之前的错误消息
      if (message?.type === 'error') {
        setMessage(null)
      }
    } catch (error: any) {
      // 只在真正失败时显示错误
      const errorMessage = error.message || '加载失败'
      // 如果错误消息包含 HTML 相关的内容，提供更友好的提示
      if (errorMessage.includes('HTML') || errorMessage.includes('<!DOCTYPE')) {
        setMessage({ type: 'error', text: 'API 响应格式错误，请刷新页面重试' })
      } else {
        setMessage({ type: 'error', text: errorMessage })
      }
    } finally {
      setLoading(false)
    }
  }

  // 初始加载数据和列设置（使用缓存）
  useEffect(() => {
    loadCountries(1, false)
    loadColumnSettings()
  }, [])

  // 优化：使用防抖，避免筛选时频繁请求
  useEffect(() => {
    // 跳过初始加载（初始加载由上面的 useEffect 处理）
    const hasFilters = filters.name || filters.accountId || filters.status || filters.objective || filters.startDate || filters.endDate
    if (!hasFilters) return

    const timeoutId = setTimeout(() => {
      loadCountries(1, false) // 筛选时重置到第一页，使用缓存优先
    }, 500) // 500ms 防抖

    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.name, filters.accountId, filters.status, filters.objective, filters.startDate, filters.endDate])

  // 当排序配置改变时，重新加载数据
  useEffect(() => {
    loadCountries(1, false) // 排序时重置到第一页，使用缓存优先
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig?.key, sortConfig?.direction])

  // 执行同步（强制刷新）
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
      // 清除缓存并强制刷新
      localStorage.removeItem(getCacheKey())
      loadCountries(1, true)
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '同步失败' })
    } finally {
      setSyncing(false)
    }
  }


  // 根据可见列和顺序过滤 - 使用 useMemo 缓存，避免频繁重新计算
  const columnsToRender = useMemo(() => {
    // 如果 columnOrder 为空，使用默认顺序
    const order = columnOrder.length > 0 ? columnOrder : ALL_COUNTRY_COLUMNS.map(col => col.key)
    
    // 如果 visibleColumns 为空，使用默认可见列
    const visible = visibleColumns.length > 0 ? visibleColumns : ALL_COUNTRY_COLUMNS.filter(col => col.defaultVisible).map(col => col.key)
    
    // 确保 country 和 countryName 始终在可见列中
    const visibleWithCountry = [...new Set(['country', 'countryName', ...visible])]
    
    // 按照 columnOrder 的顺序，只包含可见的列
    let result = order
      .filter(key => visibleWithCountry.includes(key))
      .map(key => ALL_COUNTRY_COLUMNS.find(col => col.key === key))
      .filter((col): col is typeof ALL_COUNTRY_COLUMNS[0] => col !== undefined)
    
    // 强制确保 country 和 countryName 在最前面
    const countryCol = ALL_COUNTRY_COLUMNS.find(col => col.key === 'country')
    const countryNameCol = ALL_COUNTRY_COLUMNS.find(col => col.key === 'countryName')
    result = result.filter(col => col.key !== 'country' && col.key !== 'countryName')
    if (countryNameCol) result.unshift(countryNameCol)
    if (countryCol) result.unshift(countryCol)
    
    return result
  }, [visibleColumns, columnOrder])

  // 错误处理：如果 columnsToRender 为空，使用默认列 - 也使用 useMemo
  const safeColumnsToRender = useMemo(() => {
    return columnsToRender.length > 0 
      ? columnsToRender 
      : ALL_COUNTRY_COLUMNS.filter(col => col.defaultVisible)
  }, [columnsToRender])

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 relative overflow-hidden">

      <div className="relative z-10 max-w-7xl mx-auto space-y-6">
        {/* 纯白底头部 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">国家管理</h1>
            <span className="bg-slate-100 border border-slate-200 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-700">
              Total: {pagination.total}
            </span>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`group px-6 py-3 bg-slate-900 hover:bg-slate-800 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95 ${syncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              <svg className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? '同步中...' : '同步广告系列'}
            </button>

            {/* 纯白底自定义列设置按钮 */}
            <button
              onClick={() => setShowColumnSettings(true)}
              className="px-6 py-3 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 transition-all shadow-sm active:scale-95 flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                自定义列
            </button>

              {/* iOS 风格自定义列设置弹窗 */}
              {showColumnSettings && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                  <div 
                    className="absolute inset-0" 
                    onClick={() => setShowColumnSettings(false)}
                  ></div>
                  <div className="bg-white/95 backdrop-blur-2xl border border-white/50 rounded-3xl p-8 w-full max-w-xl shadow-2xl shadow-black/20 relative z-10 transform transition-all scale-100">
                    <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
                        <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 rounded-2xl text-white shadow-lg shadow-blue-500/30">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </div>
                        自定义列
                    </h2>
                    
                    {/* 纯白底搜索框 */}
                    <div className="mb-4">
                        <div className="relative">
                            <input
                                type="text"
                                value={columnSearchQuery}
                                onChange={(e) => setColumnSearchQuery(e.target.value)}
                                placeholder="搜索字段名..."
                                className="w-full px-4 py-3 pl-10 bg-white border border-slate-300 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 transition-all shadow-sm"
                            />
                            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            {columnSearchQuery && (
                                <button
                                    onClick={() => setColumnSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors p-1 hover:bg-white/30 rounded-lg"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-4 text-sm text-slate-700">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        <span>💡 拖拽列标题可以调整顺序</span>
                    </div>
                    
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                      {/* 过滤列列表 */}
                      {(() => {
                        const allColumns = columnOrder.length > 0 ? columnOrder : ALL_COUNTRY_COLUMNS.map(col => col.key)
                        const filteredColumns = columnSearchQuery
                          ? allColumns.filter(colKey => {
                              const col = ALL_COUNTRY_COLUMNS.find(c => c.key === colKey)
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
                            const col = ALL_COUNTRY_COLUMNS.find(c => c.key === colKey)
                            if (!col) return null
                            // 使用当前 columnOrder 或默认顺序
                            const currentOrder = columnOrder.length > 0 ? columnOrder : ALL_COUNTRY_COLUMNS.map(c => c.key)
                            const actualIndex = currentOrder.indexOf(colKey)
                            
                            return (
                              <div
                                key={col.key}
                                draggable={!columnSearchQuery} // 搜索时禁用拖拽
                                onDragStart={() => handleDragStart(actualIndex)}
                                onDragOver={(e) => handleDragOver(e, actualIndex)}
                                onDragEnd={handleDragEnd}
                                className={`flex items-center space-x-3 p-3 rounded-2xl border transition-all ${
                                  columnSearchQuery ? 'cursor-default' : 'cursor-move'
                                } ${
                                  draggedIndex === actualIndex
                                    ? 'bg-blue-50 border-blue-300 shadow-md'
                                    : 'bg-white border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                            {/* 拖拽手柄 */}
                            <div className="flex items-center text-slate-500 hover:text-slate-700">
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
                              className="form-checkbox h-4 w-4 text-slate-600 bg-white border-slate-300 rounded focus:ring-slate-400"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <label
                              htmlFor={`col-${col.key}`}
                              className="flex-1 text-sm font-medium leading-none text-slate-900 cursor-pointer"
                            >
                              {col.label}
                            </label>
                          </div>
                            )
                          })
                        )
                      })()}
                    </div>
                    <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
                      <button onClick={() => {
                        setShowColumnSettings(false)
                        setColumnSearchQuery('') // 关闭时清空搜索
                      }} className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-slate-700 font-semibold transition-all shadow-sm active:scale-95">
                        取消
                      </button>
                      <button onClick={() => {
                        saveColumnSettings(visibleColumns, columnOrder)
                        setColumnSearchQuery('') // 保存时清空搜索
                      }} className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 rounded-2xl text-white font-semibold transition-all shadow-md hover:shadow-lg active:scale-95">
                        保存设置
                      </button>
                    </div>
                  </div>
          </div>
              )}
            </div> {/* This div closes the header items flex container */}
        </header>

        {/* 纯白底消息提示 */}
        {message && (
          <div className={`p-5 rounded-3xl border shadow-xl animate-fade-in ${
            message.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
              : 'bg-red-50 border-red-200 text-red-800'
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
                        <div key={idx} className="text-xs pl-3 border-l-2 border-amber-400 bg-amber-50 rounded-r-lg py-1.5">
                          {err.accountId && <span className="font-mono text-amber-900">账户: {err.accountId}</span>}
                          {err.tokenId && <span className="font-mono text-amber-900">Token: {err.tokenId.substring(0, 8)}...</span>}
                          {err.optimizer && <span className="ml-2 text-amber-900">优化师: {err.optimizer}</span>}
                          <div className="mt-1 text-amber-800">{err.error}</div>
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
                      className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-blue-50 hover:bg-blue-100 rounded-2xl text-sm font-semibold text-blue-700 transition-all active:scale-95 shadow-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      前往日志中心查看完整日志
                    </a>
                  </div>
                )}
              </div>
              <button onClick={() => setMessage(null)} className="opacity-60 hover:opacity-100 p-2 hover:bg-white/50 rounded-xl transition-all flex-shrink-0 active:scale-95">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            </div>
          </div>
        )}

        {/* 筛选区域 */}
        <section className="bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center justify-between mb-6">
             <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
               <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
               筛选条件
             </h2>
             {(filters.name || filters.accountId || filters.status || filters.objective || filters.startDate !== today || filters.endDate !== today) && (
                 <button 
                   onClick={() => setFilters({ name: '', accountId: '', status: '', objective: '', startDate: today, endDate: today })} 
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
              <label className="block text-xs font-semibold text-slate-600 mb-2 group-focus-within:text-blue-600 transition-colors">广告系列名称</label>
              <input
                type="text"
                value={filters.name}
                onChange={e => setFilters({...filters, name: e.target.value})}
                placeholder="输入名称"
                className="w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all shadow-sm"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-600 mb-2 group-focus-within:text-blue-600 transition-colors">账户ID</label>
              <input
                type="text"
                value={filters.accountId}
                onChange={e => setFilters({...filters, accountId: e.target.value})}
                placeholder="输入账户ID"
                className="w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all shadow-sm"
              />
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-600 mb-2 group-focus-within:text-blue-600 transition-colors">状态</label>
              <div className="relative">
                <select
                  value={filters.status}
                  onChange={e => setFilters({...filters, status: e.target.value})}
                  className="w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all appearance-none cursor-pointer shadow-sm"
                >
                  <option value="">全部状态</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PAUSED">PAUSED</option>
                  <option value="ARCHIVED">ARCHIVED</option>
                  <option value="DELETED">DELETED</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>
            <div className="group">
              <label className="block text-xs font-semibold text-slate-600 mb-2 group-focus-within:text-blue-600 transition-colors">目标</label>
              <input
                type="text"
                value={filters.objective}
                onChange={e => setFilters({...filters, objective: e.target.value})}
                placeholder="输入目标 (如 LEAD_GENERATION)"
                className="w-full px-4 py-3 bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all shadow-sm"
              />
            </div>
            <div>
               <button
                 onClick={() => loadCountries(1)}
                 className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-2xl text-sm font-semibold transition-all shadow-lg shadow-blue-500/30 active:scale-95"
               >
                 执行筛选
               </button>
            </div>
          </div>
        </section>

        {/* 纯白底广告系列列表 */}
        <section className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-black/5 border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {safeColumnsToRender.map(col => (
                    <th 
                      key={col.key} 
                      className="px-6 py-5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors select-none"
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
                  <th className="px-6 py-5 font-semibold text-slate-900 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={safeColumnsToRender.length + 1} className="px-6 py-12 text-center text-slate-500 animate-pulse">加载中...</td></tr>
                ) : countries.length === 0 ? (
                  <tr><td colSpan={safeColumnsToRender.length + 1} className="px-6 py-12 text-center text-slate-500">暂无数据</td></tr>
                ) : (
                  countries.map((country) => (
                    <tr key={country.id || (country as any).id} className="group hover:bg-slate-50 transition-colors border-b border-slate-100">
                      {safeColumnsToRender.map(col => (
                        <td key={col.key} className="px-6 py-4">
                          {col.key === 'country' ? (
                            <div>
                              <div className="font-semibold text-slate-900 group-hover:text-slate-950 transition-colors">{(col.format as (v: string) => string)(country.country || (country as any).country)}</div>
                            </div>
                          ) : (
                            <span className="text-slate-900">{(country as any)[col.key] !== undefined && (country as any)[col.key] !== null ? col.format((country as any)[col.key]) : '-'}</span>
                          )}
                          </td>
                      ))}
                      <td className="px-6 py-4 text-right">
                        <button className="opacity-60 hover:opacity-100 p-2 hover:bg-slate-100 rounded-xl transition-all active:scale-95">
                          <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* 纯白底分页 */}
          {pagination.pages > 1 && (
            <div className="px-6 py-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-sm text-slate-700 font-medium">
                显示 {(pagination.page - 1) * pagination.limit + 1} - {Math.min(pagination.page * pagination.limit, pagination.total)} 共 {pagination.total} 条
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => loadCountries(pagination.page - 1)}
                  disabled={pagination.page === 1}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                >
                  上一页
                </button>
                <button
                  onClick={() => loadCountries(pagination.page + 1)}
                  disabled={pagination.page >= pagination.pages}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
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
