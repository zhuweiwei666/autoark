import { useState, useEffect } from 'react'
import { getPurchaseValueInfo, type PurchaseValueInfo } from '../services/api'

interface PurchaseValueTooltipProps {
  campaignId: string
  date: string
  country?: string
  value: number
  children: React.ReactNode
}

export default function PurchaseValueTooltip({
  campaignId,
  date,
  country,
  value,
  children,
}: PurchaseValueTooltipProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [info, setInfo] = useState<PurchaseValueInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (showTooltip && !info && !loading) {
      setLoading(true)
      getPurchaseValueInfo({ campaignId, date, country })
        .then((response) => {
          setInfo(response.data)
        })
        .catch((error) => {
          console.error('Failed to fetch purchase value info:', error)
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [showTooltip, campaignId, date, country, info, loading])

  const formatCurrency = (v: number) => {
    return `$${v.toFixed(2)}`
  }

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {children}
      {showTooltip && (
        <div className="absolute z-50 left-0 bottom-full mb-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-4">
          <div className="text-xs font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Purchase Value 详情
          </div>
          {loading ? (
            <div className="text-xs text-slate-500">加载中...</div>
          ) : info ? (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Today:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(info.today)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">Yesterday:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(info.yesterday)}</span>
              </div>
              <div className="flex justify-between items-center border-t border-slate-200 pt-2">
                <span className="text-slate-600">Last 7d:</span>
                <span className="font-semibold text-slate-900">{formatCurrency(info.last7d)}</span>
              </div>
              <div className="flex justify-between items-center bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mt-2">
                <span className="text-indigo-700 font-medium">推荐值:</span>
                <span className="font-bold text-indigo-900">{formatCurrency(info.corrected)}</span>
              </div>
              <div className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-200">
                最后更新: {new Date(info.lastUpdated).toLocaleString('zh-CN')}
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">暂无数据</div>
          )}
          {/* 箭头 */}
          <div className="absolute left-4 bottom-0 transform translate-y-full">
            <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-200"></div>
            <div className="absolute left-0 top-0 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-white" style={{ marginTop: '-1px' }}></div>
          </div>
        </div>
      )}
    </div>
  )
}

