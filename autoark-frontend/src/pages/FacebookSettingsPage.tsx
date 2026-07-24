import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTokens, getPixels, getPixelDetails, getPixelEvents, checkTokenStatus, updateToken, deleteToken, authFetch, type FbToken, type FbPixel, type PixelDetails, type PixelEvent } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

type TabType = 'tokens' | 'pixels'

export default function FacebookSettingsPage() {
  const queryClient = useQueryClient()
  const { isSuperAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('tokens')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Token 状态
  const [checkingToken, setCheckingToken] = useState<string | null>(null)
  const [showBindModal, setShowBindModal] = useState(false)
  const [bindingToken, setBindingToken] = useState(false)
  const [bindForm, setBindForm] = useState({ token: '', optimizer: '' })
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null)
  const [editOptimizer, setEditOptimizer] = useState('')
  const [savingTokenId, setSavingTokenId] = useState<string | null>(null)
  const optimizerInputRef = useRef<HTMLInputElement>(null)
  
  // Pixel 状态
  const [allTokens, setAllTokens] = useState(false)
  const [selectedTokenId, setSelectedTokenId] = useState('')
  const [pixelsRefreshing, setPixelsRefreshing] = useState(false)
  const [selectedPixel, setSelectedPixel] = useState<FbPixel | null>(null)
  const [pixelDetails, setPixelDetails] = useState<PixelDetails | null>(null)
  const [pixelEvents, setPixelEvents] = useState<PixelEvent[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [showEvents, setShowEvents] = useState(false)

  // Token 查询 - 默认自动加载
  const { data: tokenData, isLoading: tokensLoading, refetch: refetchTokens, isFetching: tokensFetching } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => getTokens({ pageSize: 200 }),
    enabled: true, // 页面进入默认加载
    staleTime: Infinity, // 永不过期，只在手动刷新时更新
  })
  const tokens = tokenData?.data || []
  const activeTokens = useMemo(
    () => tokenData?.data.filter(token => token.status === 'active') || [],
    [tokenData],
  )

  useEffect(() => {
    if (activeTokens.some(token => token.id === selectedTokenId)) return
    const nextTokenId = activeTokens[0]?.id || ''
    if (nextTokenId !== selectedTokenId) setSelectedTokenId(nextTokenId)
  }, [activeTokens, selectedTokenId])

  // Pixel 查询 - 在切换到像素 Tab 时加载
  const pixelQueryKey = ['pixels', {
    allTokens,
    tokenId: allTokens ? undefined : selectedTokenId,
  }]
  const { data: pixelData, isLoading: pixelsLoading, refetch: refetchPixels, isFetching: pixelsFetching } = useQuery({
    queryKey: pixelQueryKey,
    queryFn: () => allTokens
      ? getPixels({ allTokens: true })
      : getPixels({ tokenId: selectedTokenId }),
    enabled: isSuperAdmin && activeTab === 'pixels' && (allTokens || Boolean(selectedTokenId)),
    staleTime: Infinity,
  })
  const pixels = pixelData?.data || []

  // 手动加载数据
  const handleRefresh = async () => {
    if (activeTab === 'tokens') {
      await refetchTokens()
    } else if (isSuperAdmin) {
      setPixelsRefreshing(true)
      setMessage(null)
      try {
        if (allTokens) {
          await refetchPixels()
        } else if (selectedTokenId) {
          const refreshed = await getPixels({ tokenId: selectedTokenId, refresh: true })
          queryClient.setQueryData(pixelQueryKey, refreshed)
        }
        setMessage({
          type: 'success',
          text: allTokens
            ? '已读取所有 Token 的最新缓存'
            : '所选 Token 的账户、像素、Page 和 Catalog 已同步',
        })
      } catch (error: any) {
        setMessage({ type: 'error', text: error.message || '同步失败' })
      } finally {
        setPixelsRefreshing(false)
      }
    }
  }

  // Token 操作
  const handleCheckToken = async (token: FbToken) => {
    setCheckingToken(token.id)
    try {
      await checkTokenStatus(token.id)
      setMessage({ type: 'success', text: 'Token 状态已更新' })
      refetchTokens()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '检查失败' })
    } finally {
      setCheckingToken(null)
    }
  }

  const handleDeleteToken = async (token: FbToken) => {
    if (!confirm(`确定要删除 ${token.optimizer || token.fbUserName || 'Token'} 吗？`)) return
    try {
      await deleteToken(token.id)
      setMessage({ type: 'success', text: '删除成功' })
      refetchTokens()
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '删除失败' })
    }
  }

  const handleStartOptimizerEdit = (token: FbToken) => {
    if (savingTokenId) return
    setEditingTokenId(token.id)
    setEditOptimizer(token.optimizer || '')
    setMessage(null)
  }

  const handleCancelOptimizerEdit = () => {
    if (savingTokenId) return
    setEditingTokenId(null)
    setEditOptimizer('')
  }

  const handleSaveOptimizer = async (token: FbToken) => {
    if (savingTokenId) return
    let updateSucceeded = false
    setSavingTokenId(token.id)
    setMessage(null)
    try {
      await updateToken(token.id, { optimizer: editOptimizer.trim() })
      updateSucceeded = true
      await refetchTokens({ throwOnError: true })
      setEditingTokenId(null)
      setEditOptimizer('')
      setMessage({ type: 'success', text: '优化师已更新' })
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: updateSucceeded
          ? '优化师已保存，但列表刷新失败；请点击刷新后确认'
          : error.message || '优化师更新失败',
      })
      requestAnimationFrame(() => optimizerInputRef.current?.focus())
    } finally {
      setSavingTokenId(null)
    }
  }

  // 绑定 Token
  const handleBindToken = async () => {
    if (!bindForm.token.trim()) {
      setMessage({ type: 'error', text: '请输入 Token' })
      return
    }
    setBindingToken(true)
    try {
      const res = await authFetch('/api/fb-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: bindForm.token.trim(),
          optimizer: bindForm.optimizer.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setMessage({ type: 'success', text: `Token 绑定成功！FB用户: ${data.data.fbUserName || data.data.fbUserId}` })
        setShowBindModal(false)
        setBindForm({ token: '', optimizer: '' })
        refetchTokens()
      } else {
        setMessage({ type: 'error', text: data.message || '绑定失败' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || '绑定失败' })
    } finally {
      setBindingToken(false)
    }
  }

  // Pixel 操作
  const loadPixelDetails = async (pixel: FbPixel) => {
    try {
      const response = await getPixelDetails(pixel.id, pixel.tokenId)
      setPixelDetails(response.data)
      setSelectedPixel(pixel)
      setShowDetails(true)
    } catch (error: any) {
      setMessage({ type: 'error', text: `加载详情失败: ${error.message}` })
    }
  }

  const loadPixelEvents = async (pixel: FbPixel) => {
    try {
      const response = await getPixelEvents(pixel.id, pixel.tokenId)
      setPixelEvents(response.data || [])
      setSelectedPixel(pixel)
      setShowEvents(true)
    } catch (error: any) {
      setMessage({ type: 'error', text: `加载事件失败: ${error.message}` })
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    try {
      return new Date(dateString).toLocaleString('zh-CN')
    } catch {
      return dateString
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'expired': return 'bg-amber-50 text-amber-700 border-amber-200'
      case 'invalid': return 'bg-red-50 text-red-700 border-red-200'
      default: return 'bg-slate-50 text-slate-700 border-slate-200'
    }
  }

  const loading = activeTab === 'tokens' ? tokensLoading : pixelsLoading
  const fetching = activeTab === 'tokens' ? tokensFetching : pixelsFetching
  let refreshLabel = '刷新数据'
  if (pixelsRefreshing) refreshLabel = '同步中...'
  else if (fetching) refreshLabel = '加载中...'
  else if (activeTab === 'pixels' && !allTokens) refreshLabel = '同步所选 Token'

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{isSuperAdmin ? 'Token & 像素' : 'Token 管理'}</h1>
            <span className="bg-slate-100 border border-slate-200 px-3 py-1 rounded-full text-xs font-medium text-slate-500">
              低频配置
            </span>
          </div>
          <div className="flex items-center gap-3">
            {isSuperAdmin && activeTab === 'pixels' && (
              <>
                <select
                  value={selectedTokenId}
                  onChange={(event) => setSelectedTokenId(event.target.value)}
                  disabled={allTokens}
                  aria-label="选择 Facebook Token"
                  className="min-w-56 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {activeTokens.length === 0 && <option value="">暂无活跃 Token</option>}
                  {activeTokens.map((token) => (
                    <option key={token.id} value={token.id}>
                      {token.optimizer || token.fbUserName || token.fbUserId || token.id}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-2xl text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 transition-all">
                  <input
                    type="checkbox"
                    checked={allTokens}
                    onChange={(e) => setAllTokens(e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  <span>所有 Token</span>
                </label>
              </>
            )}
            {activeTab === 'tokens' && (
              <button
                onClick={() => setShowBindModal(true)}
                className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 rounded-2xl text-sm font-semibold text-white shadow-lg shadow-blue-500/30 hover:shadow-xl transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
                绑定 Token
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={
                loading ||
                fetching ||
                pixelsRefreshing ||
                (activeTab === 'pixels' && !allTokens && !selectedTokenId)
              }
              className={`px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all flex items-center gap-2 ${
                loading || fetching || pixelsRefreshing ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              <svg className={`w-5 h-5 ${fetching || pixelsRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {refreshLabel}
            </button>
          </div>
        </header>

        {/* 消息提示 */}
        {message && (
          <div role={message.type === 'error' ? 'alert' : 'status'} className={`p-4 rounded-2xl border flex items-center justify-between ${
            message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} aria-label="关闭提示" className="opacity-60 hover:opacity-100 p-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Tab 切换 */}
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('tokens')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              activeTab === 'tokens'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            🔑 Token 管理
          </button>
          {isSuperAdmin && (
            <button
              onClick={() => setActiveTab('pixels')}
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'pixels'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              ✨ 像素管理
            </button>
          )}
        </div>

        {isSuperAdmin && activeTab === 'pixels' && pixelData?.meta && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['广告账户', pixelData.meta.accountCount],
              ['Pixels', pixelData.meta.pixelCount],
              ['Pages', pixelData.meta.pageCount],
              ['Catalogs', pixelData.meta.catalogCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-1 text-lg font-bold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* 空状态 */}
        {!loading && !fetching && ((activeTab === 'tokens' && tokens.length === 0) || (activeTab === 'pixels' && pixels.length === 0)) && (
          <div className="text-center py-16 bg-white rounded-3xl border border-slate-200">
            <div className="text-6xl mb-4">{activeTab === 'tokens' ? '🔑' : '✨'}</div>
            <p className="text-slate-500 mb-2">暂无{activeTab === 'tokens' ? ' Token' : '像素'}数据</p>
            <p className="text-xs text-slate-400">可点击“刷新数据”或新增后查看</p>
          </div>
        )}

        {/* Token 列表 */}
        {activeTab === 'tokens' && tokens.length > 0 && (
          <section className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-black/5 border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-6 py-4 font-semibold text-slate-900">优化师</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">FB 用户</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">状态</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">过期时间</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">最后检查</th>
                    <th className="px-6 py-4 font-semibold text-slate-900 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token: FbToken) => (
                    <tr key={token.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium">
                        {editingTokenId === token.id ? (
                          <input
                            ref={optimizerInputRef}
                            type="text"
                            value={editOptimizer}
                            onChange={(e) => setEditOptimizer(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.nativeEvent.isComposing) return
                              if (e.key === 'Enter') handleSaveOptimizer(token)
                              if (e.key === 'Escape') handleCancelOptimizerEdit()
                            }}
                            maxLength={80}
                            disabled={savingTokenId === token.id}
                            aria-label={`编辑 ${token.fbUserName || token.fbUserId || 'Token'} 的优化师`}
                            className="w-36 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:opacity-60"
                            autoFocus
                          />
                        ) : (
                          token.optimizer || '-'
                        )}
                      </td>
                      <td className="px-6 py-4">{token.fbUserName || token.fbUserId || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor(token.status)}`}>
                          {token.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(token.expiresAt)}</td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(token.lastCheckedAt)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {editingTokenId === token.id ? (
                            <>
                              <button
                                onClick={() => handleSaveOptimizer(token)}
                                disabled={savingTokenId === token.id}
                                aria-label="保存优化师"
                                className="px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {savingTokenId === token.id ? '保存中...' : '保存'}
                              </button>
                              <button
                                onClick={handleCancelOptimizerEdit}
                                disabled={savingTokenId === token.id}
                                aria-label="取消编辑优化师"
                                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleStartOptimizerEdit(token)}
                                disabled={Boolean(savingTokenId)}
                                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                              >
                                编辑
                              </button>
                              <button
                                onClick={() => handleCheckToken(token)}
                                disabled={checkingToken === token.id || Boolean(savingTokenId)}
                                className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {checkingToken === token.id ? '检查中...' : '检查'}
                              </button>
                              <button
                                onClick={() => handleDeleteToken(token)}
                                disabled={Boolean(savingTokenId)}
                                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Pixel 列表 */}
        {isSuperAdmin && activeTab === 'pixels' && pixels.length > 0 && (
          <section className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-black/5 border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-6 py-4 font-semibold text-slate-900">Pixel ID</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">名称</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">所属 Business</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">创建时间</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">最后触发</th>
                    <th className="px-6 py-4 font-semibold text-slate-900">自动匹配</th>
                    <th className="px-6 py-4 font-semibold text-slate-900 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pixels.map((pixel: FbPixel) => (
                    <tr key={`${pixel.id}-${pixel.tokenId || 'default'}`} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-6 py-4 font-mono text-xs">{pixel.id}</td>
                      <td className="px-6 py-4 font-medium">{pixel.name}</td>
                      <td className="px-6 py-4">
                        <div>
                          <div>{pixel.owner_business?.name || '-'}</div>
                          <div className="text-xs text-slate-400">{pixel.owner_business?.id}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(pixel.creation_time)}</td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(pixel.last_fired_time)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                          pixel.enable_automatic_matching ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500'
                        }`}>
                          {pixel.enable_automatic_matching ? '已启用' : '未启用'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => loadPixelDetails(pixel)}
                            className="px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            详情
                          </button>
                          <button
                            onClick={() => loadPixelEvents(pixel)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            事件
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Pixel 详情弹窗 */}
        {showDetails && pixelDetails && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDetails(false)}>
            <div className="bg-white rounded-3xl p-6 max-w-lg w-full mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">Pixel 详情</h3>
                <button onClick={() => setShowDetails(false)} className="p-2 hover:bg-slate-100 rounded-xl">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">Pixel ID</span>
                  <span className="font-mono">{pixelDetails.id}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">名称</span>
                  <span>{pixelDetails.name}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-100">
                  <span className="text-slate-500">数据用途</span>
                  <span>{pixelDetails.data_use_setting || '-'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pixel 事件弹窗 */}
        {showEvents && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowEvents(false)}>
            <div className="bg-white rounded-3xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">Pixel 事件 - {selectedPixel?.name}</h3>
                <button onClick={() => setShowEvents(false)} className="p-2 hover:bg-slate-100 rounded-xl">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {pixelEvents.length === 0 ? (
                <p className="text-center text-slate-500 py-8">暂无事件数据</p>
              ) : (
                <div className="space-y-2">
                  {pixelEvents.map((event, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 rounded-xl text-sm">
                      <div className="font-medium">{event.event_name}</div>
                      <div className="text-xs text-slate-500">{formatDate(new Date(event.event_time * 1000).toISOString())}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 绑定 Token 弹窗 */}
        {showBindModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowBindModal(false)}>
            <div className="bg-white rounded-3xl p-8 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-slate-900 flex items-center gap-3">
                  <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2.5 rounded-xl text-white">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                  </div>
                  绑定 Facebook Token
                </h3>
                <button onClick={() => setShowBindModal(false)} className="p-2 hover:bg-slate-100 rounded-xl transition-colors">
                  <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Access Token <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={bindForm.token}
                    onChange={e => setBindForm({ ...bindForm, token: e.target.value })}
                    placeholder="粘贴 Facebook Access Token..."
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all resize-none font-mono"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    从 Facebook Business 或开发者工具获取的长期访问令牌
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    优化师名称 <span className="text-slate-400 font-normal">(选填)</span>
                  </label>
                  <input
                    type="text"
                    value={bindForm.optimizer}
                    onChange={e => setBindForm({ ...bindForm, optimizer: e.target.value })}
                    placeholder="用于标识此 Token 的负责人"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition-all"
                  />
                </div>
              </div>
              
              <div className="flex gap-3 mt-8">
                <button
                  onClick={() => setShowBindModal(false)}
                  className="flex-1 px-6 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-semibold text-slate-700 transition-all"
                >
                  取消
                </button>
                <button
                  onClick={handleBindToken}
                  disabled={bindingToken || !bindForm.token.trim()}
                  className={`flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 rounded-xl text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2 ${
                    bindingToken || !bindForm.token.trim() ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  {bindingToken ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      验证中...
                    </>
                  ) : '确认绑定'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
