import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPixels, getPixelDetails, getPixelEvents } from '../services/api'
import type { FbPixel, PixelDetails, PixelEvent } from '../services/api'

export default function FacebookPixelsPage() {
  const [selectedPixel, setSelectedPixel] = useState<FbPixel | null>(null)
  const [pixelDetails, setPixelDetails] = useState<PixelDetails | null>(null)
  const [pixelEvents, setPixelEvents] = useState<PixelEvent[]>([])
  const [showDetails, setShowDetails] = useState(false)
  const [showEvents, setShowEvents] = useState(false)
  const [allTokens, setAllTokens] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 使用 React Query 获取 Pixels（使用全局缓存策略）
  const { data, isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: ['pixels', { allTokens }],
    queryFn: () => getPixels({ allTokens }),
    placeholderData: (previousData) => previousData,
  })

  const pixels = data?.data || []

  const loadPixelDetails = async (pixel: FbPixel) => {
    try {
      const response = await getPixelDetails(pixel.id, pixel.tokenId)
      setPixelDetails(response.data)
      setSelectedPixel(pixel)
      setShowDetails(true)
    } catch (error: any) {
      setMessage({ type: 'error', text: `加载 Pixel 详情失败: ${error.message}` })
    }
  }

  const loadPixelEvents = async (pixel: FbPixel) => {
    try {
      const response = await getPixelEvents(pixel.id, pixel.tokenId)
      setPixelEvents(response.data || [])
      setSelectedPixel(pixel)
      setShowEvents(true)
    } catch (error: any) {
      setMessage({ type: 'error', text: `加载 Pixel 事件失败: ${error.message}` })
    }
  }

  const loadPixels = () => refetch()

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    try {
      return new Date(dateString).toLocaleString('zh-CN')
    } catch {
      return dateString
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6 relative overflow-hidden">
      <div className="relative z-10 max-w-7xl mx-auto space-y-6">
        {/* 头部 */}
        <header className="flex items-center justify-between bg-white rounded-3xl p-6 shadow-lg shadow-black/5 border border-slate-200">
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">像素管理</h1>
            <span className="bg-slate-100 border border-slate-200 px-4 py-1.5 rounded-full text-xs font-semibold text-slate-700">
              Total: {pixels.length}
            </span>
            {isFetching && !loading && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 animate-pulse">
                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                更新中...
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-2xl text-sm font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 transition-all">
              <input
                type="checkbox"
                checked={allTokens}
                onChange={(e) => setAllTokens(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span>显示所有 Token 的 Pixels</span>
            </label>
            <button
              onClick={loadPixels}
              disabled={loading}
              className={`px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-2xl text-sm font-semibold text-white shadow-md hover:shadow-lg transition-all duration-200 flex items-center gap-2 active:scale-95 ${
                loading ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              <svg
                className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              {loading ? '加载中...' : '刷新'}
            </button>
          </div>
        </header>

        {/* 消息提示 */}
        {message && (
          <div
            className={`p-4 rounded-2xl border ${
              message.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            } flex items-center justify-between`}
          >
            <span>{message.text}</span>
            <button
              onClick={() => setMessage(null)}
              className="opacity-60 hover:opacity-100 p-2 hover:bg-white/50 rounded-xl transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Pixel 列表 */}
        <section className="bg-white rounded-3xl overflow-hidden shadow-lg shadow-black/5 border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-6 py-5 font-semibold text-slate-900">Pixel ID</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">名称</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">所属 Business</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">创建时间</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">最后触发时间</th>
                  <th className="px-6 py-5 font-semibold text-slate-900">自动匹配</th>
                  {allTokens && <th className="px-6 py-5 font-semibold text-slate-900">Token 信息</th>}
                  <th className="px-6 py-5 font-semibold text-slate-900 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={allTokens ? 8 : 7} className="px-6 py-12 text-center text-slate-500 animate-pulse">
                      加载中...
                    </td>
                  </tr>
                ) : pixels.length === 0 ? (
                  <tr>
                    <td colSpan={allTokens ? 8 : 7} className="px-6 py-12 text-center text-slate-500">
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  pixels.map((pixel) => (
                    <tr
                      key={`${pixel.id}-${pixel.tokenId || 'default'}`}
                      className="group hover:bg-slate-50 transition-colors border-b border-slate-100"
                    >
                      <td className="px-6 py-4">
                        <div className="text-xs text-slate-700 font-mono">{pixel.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{pixel.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        {pixel.owner_business ? (
                          <div>
                            <div className="text-slate-900">{pixel.owner_business.name}</div>
                            <div className="text-xs text-slate-500 font-mono">{pixel.owner_business.id}</div>
                          </div>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-700">{formatDate(pixel.creation_time)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-700">{formatDate(pixel.last_fired_time)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${
                            pixel.enable_automatic_matching
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-slate-50 border-slate-200 text-slate-700'
                          }`}
                        >
                          {pixel.enable_automatic_matching ? '已启用' : '未启用'}
                        </span>
                      </td>
                      {allTokens && (
                        <td className="px-6 py-4">
                          <div className="text-xs text-slate-700">
                            {pixel.fbUserName && <div>{pixel.fbUserName}</div>}
                            {pixel.fbUserId && <div className="font-mono text-slate-500">{pixel.fbUserId}</div>}
                          </div>
                        </td>
                      )}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => loadPixelDetails(pixel)}
                            className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-semibold transition-all active:scale-95"
                          >
                            详情
                          </button>
                          <button
                            onClick={() => loadPixelEvents(pixel)}
                            className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-all active:scale-95"
                          >
                            事件
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Pixel 详情弹窗 */}
        {showDetails && pixelDetails && selectedPixel && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-slate-900">Pixel 详情</h2>
                <button
                  onClick={() => {
                    setShowDetails(false)
                    setPixelDetails(null)
                  }}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-slate-600">Pixel ID</label>
                  <div className="mt-1 text-slate-900 font-mono text-sm">{pixelDetails.id}</div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-600">名称</label>
                  <div className="mt-1 text-slate-900">{pixelDetails.name}</div>
                </div>
                {pixelDetails.owner_business && (
                  <div>
                    <label className="text-sm font-semibold text-slate-600">所属 Business</label>
                    <div className="mt-1">
                      <div className="text-slate-900">{pixelDetails.owner_business.name}</div>
                      <div className="text-xs text-slate-500 font-mono">{pixelDetails.owner_business.id}</div>
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-sm font-semibold text-slate-600">创建时间</label>
                  <div className="mt-1 text-slate-900">{formatDate(pixelDetails.creation_time)}</div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-600">最后触发时间</label>
                  <div className="mt-1 text-slate-900">{formatDate(pixelDetails.last_fired_time)}</div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-600">自动匹配</label>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold border ${
                        pixelDetails.enable_automatic_matching
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      {pixelDetails.enable_automatic_matching ? '已启用' : '未启用'}
                    </span>
                  </div>
                </div>
                {pixelDetails.code && (
                  <div>
                    <label className="text-sm font-semibold text-slate-600">Pixel 代码</label>
                    <div className="mt-1 p-3 bg-slate-50 rounded-lg">
                      <code className="text-xs text-slate-900 break-all">{pixelDetails.code}</code>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Pixel 事件弹窗 */}
        {showEvents && selectedPixel && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl p-8 w-full max-w-4xl shadow-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-slate-900">Pixel 事件 - {selectedPixel.name}</h2>
                <button
                  onClick={() => {
                    setShowEvents(false)
                    setPixelEvents([])
                  }}
                  className="p-2 hover:bg-slate-100 rounded-xl transition-all"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-2">
                {pixelEvents.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">暂无事件</div>
                ) : (
                  pixelEvents.map((event, index) => (
                    <div key={index} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-slate-900">{event.event_name}</span>
                        <span className="text-xs text-slate-500">
                          {new Date(event.event_time * 1000).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      {event.event_id && (
                        <div className="text-xs text-slate-500 font-mono mb-2">Event ID: {event.event_id}</div>
                      )}
                      {event.custom_data && (
                        <div className="mt-2">
                          <details className="text-xs">
                            <summary className="cursor-pointer text-slate-600 hover:text-slate-900">自定义数据</summary>
                            <pre className="mt-2 p-2 bg-white rounded border border-slate-200 overflow-x-auto">
                              {JSON.stringify(event.custom_data, null, 2)}
                            </pre>
                          </details>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

