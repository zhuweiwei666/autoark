import { useState, useEffect } from 'react'
import Loading from '../components/Loading'

const API_BASE = '/api'

interface Ad {
  _id: string
  adId: string
  name: string
  effectiveStatus: string
  reviewFeedback?: any
  createdAt: string
  adsetId?: string
  campaignId?: string
}

interface AdSet {
  adsetId: string
  name: string
  ads: Ad[]
}

interface Campaign {
  campaignId: string
  name: string
  status: string
  adsets: AdSet[]
  totalAds: number
  pendingCount: number
  approvedCount: number
  rejectedCount: number
}

// 审核状态映射
const REVIEW_STATUS_MAP: Record<string, { label: string; color: string; icon: string }> = {
  PENDING_REVIEW: { label: '审核中', color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: '⏳' },
  ACTIVE: { label: '已通过', color: 'bg-green-100 text-green-700 border-green-200', icon: '✅' },
  DISAPPROVED: { label: '被拒绝', color: 'bg-red-100 text-red-700 border-red-200', icon: '❌' },
  PAUSED: { label: '已暂停', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: '⏸️' },
  PREAPPROVED: { label: '预通过', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: '🔵' },
  WITH_ISSUES: { label: '有问题', color: 'bg-orange-100 text-orange-700 border-orange-200', icon: '⚠️' },
  ARCHIVED: { label: '已归档', color: 'bg-gray-100 text-gray-600 border-gray-200', icon: '📦' },
  DELETED: { label: '已删除', color: 'bg-gray-100 text-gray-500 border-gray-200', icon: '🗑️' },
}

const getStatusInfo = (status: string) => {
  return REVIEW_STATUS_MAP[status] || { label: status || '未知', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: '❓' }
}

export default function AdReviewStatusPage() {
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [selectedAdset, setSelectedAdset] = useState<AdSet | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [togglingCampaign, setTogglingCampaign] = useState<string | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/ads/review-overview`)
      const data = await res.json()
      if (data.success) {
        setCampaigns(data.data.campaigns || [])
      }
    } catch (err) {
      console.error('Failed to load review data:', err)
    } finally {
      setLoading(false)
    }
  }

  const refreshReviewStatus = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/ads/refresh-review`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await loadData()
      } else {
        alert('刷新失败：' + (data.error || '未知错误'))
      }
    } catch (err) {
      console.error('Failed to refresh:', err)
      alert('刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const toggleCampaignStatus = async (campaignId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setTogglingCampaign(campaignId)
    try {
      const res = await fetch(`${API_BASE}/facebook/campaigns/${campaignId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      const data = await res.json()
      if (data.success) {
        // 更新本地状态
        setCampaigns(campaigns.map(c => 
          c.campaignId === campaignId ? { ...c, status: newStatus } : c
        ))
      } else {
        alert('操作失败：' + (data.error || '未知错误'))
      }
    } catch (err) {
      console.error('Failed to toggle campaign:', err)
      alert('操作失败')
    } finally {
      setTogglingCampaign(null)
    }
  }

  if (loading) {
    return <Loading.Page message="加载审核数据..." />
  }

  // 统计总数
  const totalStats = campaigns.reduce((acc, c) => ({
    total: acc.total + c.totalAds,
    pending: acc.pending + c.pendingCount,
    approved: acc.approved + c.approvedCount,
    rejected: acc.rejected + c.rejectedCount,
  }), { total: 0, pending: 0, approved: 0, rejected: 0 })

  return (
    <div className="p-6 h-full">
      <div className="max-w-[1600px] mx-auto h-full flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">广告审核状态</h1>
            <p className="text-slate-500 mt-1">追踪通过 AutoArk 发布的广告审核情况</p>
          </div>
          <button
            onClick={refreshReviewStatus}
            disabled={refreshing}
            className="btn-primary flex items-center gap-2"
          >
            {refreshing ? (
              <>
                <Loading.Spinner size="sm" />
                刷新中...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
                刷新审核状态
              </>
            )}
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white/80 backdrop-blur-xl rounded-xl border border-white/60 p-4 shadow-lg shadow-slate-200/50">
            <div className="text-2xl font-bold text-slate-700">{totalStats.total}</div>
            <div className="text-sm text-slate-500">总广告数</div>
          </div>
          <div className="bg-yellow-50/80 backdrop-blur-xl rounded-xl border border-yellow-200/60 p-4 shadow-lg shadow-yellow-200/30">
            <div className="text-2xl font-bold text-yellow-600">⏳ {totalStats.pending}</div>
            <div className="text-sm text-yellow-600">审核中</div>
          </div>
          <div className="bg-green-50/80 backdrop-blur-xl rounded-xl border border-green-200/60 p-4 shadow-lg shadow-green-200/30">
            <div className="text-2xl font-bold text-green-600">✅ {totalStats.approved}</div>
            <div className="text-sm text-green-600">已通过</div>
          </div>
          <div className="bg-red-50/80 backdrop-blur-xl rounded-xl border border-red-200/60 p-4 shadow-lg shadow-red-200/30">
            <div className="text-2xl font-bold text-red-600">❌ {totalStats.rejected}</div>
            <div className="text-sm text-red-600">被拒绝</div>
          </div>
        </div>

        {/* 三列布局 */}
        <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
          {/* 左列：广告系列 */}
          <div className="bg-white/80 backdrop-blur-xl rounded-xl border border-white/60 shadow-lg overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-blue-50/50 to-indigo-50/50">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-blue-500">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
                广告系列
                <span className="text-xs text-slate-500 font-normal">({campaigns.length})</span>
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {campaigns.length === 0 ? (
                <div className="text-center text-slate-500 py-8">
                  <p>暂无通过 AutoArk 发布的广告</p>
                </div>
              ) : (
                campaigns.map(campaign => (
                  <div
                    key={campaign.campaignId}
                    onClick={() => {
                      setSelectedCampaign(campaign)
                      setSelectedAdset(null)
                    }}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedCampaign?.campaignId === campaign.campaignId
                        ? 'bg-blue-50 border-2 border-blue-300 shadow-md'
                        : 'bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {/* 开关按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleCampaignStatus(campaign.campaignId, campaign.status)
                        }}
                        disabled={togglingCampaign === campaign.campaignId}
                        className={`w-10 h-5 rounded-full relative transition-all ${
                          campaign.status === 'ACTIVE' 
                            ? 'bg-green-500' 
                            : 'bg-slate-300'
                        } ${togglingCampaign === campaign.campaignId ? 'opacity-50' : ''}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                          campaign.status === 'ACTIVE' ? 'left-5' : 'left-0.5'
                        }`} />
                      </button>
                      <span className="text-xs text-slate-500">
                        {campaign.status === 'ACTIVE' ? '开启' : '关闭'}
                      </span>
                    </div>
                    <div className="font-medium text-sm text-slate-800 truncate" title={campaign.name}>
                      {campaign.name}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 truncate">
                      ID: {campaign.campaignId}
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{campaign.totalAds} 广告</span>
                      {campaign.approvedCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">✅ {campaign.approvedCount}</span>
                      )}
                      {campaign.pendingCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">⏳ {campaign.pendingCount}</span>
                      )}
                      {campaign.rejectedCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">❌ {campaign.rejectedCount}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 中列：广告组 */}
          <div className="bg-white/80 backdrop-blur-xl rounded-xl border border-white/60 shadow-lg overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-purple-50/50 to-pink-50/50">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-purple-500">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
                </svg>
                广告组
                {selectedCampaign && (
                  <span className="text-xs text-slate-500 font-normal">({selectedCampaign.adsets.length})</span>
                )}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {!selectedCampaign ? (
                <div className="text-center text-slate-400 py-8">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-12 h-12 mx-auto mb-2 opacity-50">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75L3 12m0 0l3.75-3.75M3 12h18" />
                  </svg>
                  <p>请先选择广告系列</p>
                </div>
              ) : selectedCampaign.adsets.length === 0 ? (
                <div className="text-center text-slate-500 py-8">
                  <p>该广告系列下暂无广告组</p>
                </div>
              ) : (
                selectedCampaign.adsets.map(adset => (
                  <div
                    key={adset.adsetId}
                    onClick={() => setSelectedAdset(adset)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      selectedAdset?.adsetId === adset.adsetId
                        ? 'bg-purple-50 border-2 border-purple-300 shadow-md'
                        : 'bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="font-medium text-sm text-slate-800 truncate" title={adset.name}>
                      {adset.name}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      ID: {adset.adsetId}
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">{adset.ads.length} 广告</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 右列：广告 */}
          <div className="bg-white/80 backdrop-blur-xl rounded-xl border border-white/60 shadow-lg overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-emerald-50/50 to-teal-50/50">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-emerald-500">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
                广告
                {selectedAdset && (
                  <span className="text-xs text-slate-500 font-normal">({selectedAdset.ads.length})</span>
                )}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {!selectedAdset ? (
                <div className="text-center text-slate-400 py-8">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-12 h-12 mx-auto mb-2 opacity-50">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 15.75L3 12m0 0l3.75-3.75M3 12h18" />
                  </svg>
                  <p>请先选择广告组</p>
                </div>
              ) : selectedAdset.ads.length === 0 ? (
                <div className="text-center text-slate-500 py-8">
                  <p>该广告组下暂无广告</p>
                </div>
              ) : (
                selectedAdset.ads.map(ad => {
                  const statusInfo = getStatusInfo(ad.effectiveStatus)
                  return (
                    <div
                      key={ad.adId}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs px-2 py-1 rounded-full border ${statusInfo.color}`}>
                          {statusInfo.icon} {statusInfo.label}
                        </span>
                      </div>
                      <div className="font-medium text-sm text-slate-800 truncate" title={ad.name}>
                        {ad.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        ID: {ad.adId}
                      </div>
                      {ad.effectiveStatus === 'DISAPPROVED' && ad.reviewFeedback && (
                        <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-600 border border-red-200">
                          <div className="font-medium mb-1">拒绝原因：</div>
                          {ad.reviewFeedback.global && (
                            <div>• {ad.reviewFeedback.global}</div>
                          )}
                          {ad.reviewFeedback.bodyPolicy && (
                            <div>• 文案: {ad.reviewFeedback.bodyPolicy}</div>
                          )}
                          {ad.reviewFeedback.imagePolicy && (
                            <div>• 图片: {ad.reviewFeedback.imagePolicy}</div>
                          )}
                          {ad.reviewFeedback.videoPolicy && (
                            <div>• 视频: {ad.reviewFeedback.videoPolicy}</div>
                          )}
                          {ad.reviewFeedback.landingPagePolicy && (
                            <div>• 落地页: {ad.reviewFeedback.landingPagePolicy}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
