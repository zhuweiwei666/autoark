import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AndroidLogo,
  AppleLogo,
  ArrowSquareOut,
  Check,
  Copy,
  DeviceMobile,
  FloppyDisk,
  LinkSimple,
  Plus,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import Loading from '../components/Loading'
import {
  createProductLinkPool,
  deleteProductLinkPool,
  listProductLinkDomains,
  listProductLinkPools,
  ProductLinkDestination,
  ProductLinkPlatform,
  ProductLinkPool,
  updateProductLinkPool,
} from '../services/productLinkPools'

type EditableDestination = ProductLinkDestination & {
  clientId: string
}

type PoolDraft = Omit<ProductLinkPool, 'destinations'> & {
  destinations: EditableDestination[]
}

const inputClassName =
  'w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-950 shadow-sm transition-all placeholder:text-zinc-400 focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/15'

const DEFAULT_SHORT_LINK_DOMAIN = 'go.remixhub.app'

const buildShortUrl = (hostname: string, shortCode: string) => (
  `https://${hostname}/r/${shortCode}`
)

const makeClientId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
)

const toDraft = (pool: ProductLinkPool): PoolDraft => ({
  ...pool,
  destinations: pool.destinations.map(destination => ({
    ...destination,
    clientId: destination._id || makeClientId(),
  })),
})

const toApiDestinations = (destinations: EditableDestination[]): ProductLinkDestination[] => (
  destinations.map(({ clientId: _clientId, ...destination }) => destination)
)

const destinationCount = (pool: ProductLinkPool, platform: ProductLinkPlatform) => (
  pool.destinations.filter(destination => destination.platform === platform).length
)

const validateDraft = (draft: PoolDraft): string | null => {
  if (!draft.name.trim()) return '请输入产品池名称'
  if (!draft.shortLinkDomain.trim()) return '请选择投放域名'

  for (let index = 0; index < draft.destinations.length; index += 1) {
    const destination = draft.destinations[index]
    if (!destination.name.trim()) return `第 ${index + 1} 个 App 缺少名称`
    if (!destination.url.trim()) return `第 ${index + 1} 个 App 缺少目标链接`
    try {
      const url = new URL(destination.url)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return `第 ${index + 1} 个 App 链接必须使用 http 或 https`
      }
    } catch {
      return `第 ${index + 1} 个 App 链接格式不正确`
    }
    if (
      !Number.isInteger(Number(destination.weight))
      || Number(destination.weight) < 0
      || Number(destination.weight) > 1000
    ) {
      return `第 ${index + 1} 个 App 权重必须是 0 到 1000 的整数`
    }
  }

  return null
}

export default function ProductLinkPoolsPage() {
  const queryClient = useQueryClient()
  const [selectedPoolId, setSelectedPoolId] = useState('')
  const [draft, setDraft] = useState<PoolDraft | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newPoolName, setNewPoolName] = useState('')
  const [newPoolDomain, setNewPoolDomain] = useState(DEFAULT_SHORT_LINK_DOMAIN)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const poolsQuery = useQuery({
    queryKey: ['product-link-pools'],
    queryFn: listProductLinkPools,
  })

  const domainsQuery = useQuery({
    queryKey: ['product-link-domains'],
    queryFn: listProductLinkDomains,
  })

  const pools = poolsQuery.data || []
  const availableDomains = domainsQuery.data?.domains || [
    { hostname: DEFAULT_SHORT_LINK_DOMAIN, label: 'remixhub.app（推荐）' },
  ]

  useEffect(() => {
    if (pools.length === 0) {
      setSelectedPoolId('')
      setDraft(null)
      return
    }
    if (!selectedPoolId || !pools.some(pool => pool._id === selectedPoolId)) {
      const nextPool = pools[0]
      setSelectedPoolId(nextPool._id)
      setDraft(toDraft(nextPool))
      setCopied(false)
    }
  }, [pools, selectedPoolId])

  const createMutation = useMutation({
    mutationFn: () => createProductLinkPool({
      name: newPoolName,
      shortLinkDomain: newPoolDomain,
    }),
    onSuccess: pool => {
      queryClient.setQueryData<ProductLinkPool[]>(['product-link-pools'], current => [
        pool,
        ...(current || []),
      ])
      setSelectedPoolId(pool._id)
      setDraft(toDraft(pool))
      setCopied(false)
      setShowCreate(false)
      setNewPoolName('')
      setNewPoolDomain(domainsQuery.data?.defaultDomain || DEFAULT_SHORT_LINK_DOMAIN)
      setFeedback({ type: 'success', message: '产品池已创建，短码永久不变，投放域名可随时切换。' })
    },
    onError: error => {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '创建失败' })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: PoolDraft) => {
      const error = validateDraft(nextDraft)
      if (error) throw new Error(error)
      return updateProductLinkPool(nextDraft._id, {
        name: nextDraft.name,
        description: nextDraft.description,
        shortLinkDomain: nextDraft.shortLinkDomain,
        fallbackUrl: nextDraft.fallbackUrl,
        status: nextDraft.status,
        destinations: toApiDestinations(nextDraft.destinations),
      })
    },
    onSuccess: pool => {
      queryClient.setQueryData<ProductLinkPool[]>(['product-link-pools'], current =>
        (current || []).map(item => item._id === pool._id ? pool : item),
      )
      setDraft(current => current?._id === pool._id ? toDraft(pool) : current)
      setFeedback({ type: 'success', message: '域名、权重和目标链接已保存并立即生效。' })
    },
    onError: error => {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '保存失败' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteProductLinkPool,
    onSuccess: ({ id }) => {
      queryClient.setQueryData<ProductLinkPool[]>(['product-link-pools'], current =>
        (current || []).filter(pool => pool._id !== id),
      )
      setSelectedPoolId(current => current === id ? '' : current)
      setDraft(current => current?._id === id ? null : current)
      setFeedback({ type: 'success', message: '产品池及对应短链已删除。' })
    },
    onError: error => {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : '删除失败' })
    },
  })

  const openCreateModal = () => {
    createMutation.reset()
    setNewPoolName('')
    setNewPoolDomain(domainsQuery.data?.defaultDomain || DEFAULT_SHORT_LINK_DOMAIN)
    setFeedback(null)
    setShowCreate(true)
  }

  const platformTotals = useMemo(() => {
    const totals = { ios: 0, android: 0 }
    for (const destination of draft?.destinations || []) {
      if (destination.enabled && destination.weight > 0) {
        totals[destination.platform] += Number(destination.weight)
      }
    }
    return totals
  }, [draft?.destinations])

  const updateDestination = (
    clientId: string,
    update: Partial<EditableDestination>,
  ) => {
    setDraft(current => current ? {
      ...current,
      destinations: current.destinations.map(destination =>
        destination.clientId === clientId ? { ...destination, ...update } : destination,
      ),
    } : current)
  }

  const addDestination = (platform: ProductLinkPlatform) => {
    setDraft(current => current ? {
      ...current,
      destinations: [
        ...current.destinations,
        {
          clientId: makeClientId(),
          name: '',
          platform,
          url: '',
          weight: 100,
          enabled: true,
        },
      ],
    } : current)
  }

  const removeDestination = (clientId: string) => {
    setDraft(current => current ? {
      ...current,
      destinations: current.destinations.filter(destination => destination.clientId !== clientId),
    } : current)
  }

  const copyShortUrl = async () => {
    if (!draft?.shortUrl) return
    try {
      await navigator.clipboard.writeText(draft.shortUrl)
      setCopied(true)
      setFeedback({ type: 'success', message: '短链已复制。' })
    } catch {
      setFeedback({ type: 'error', message: '复制失败，请手动复制短链。' })
    }
  }

  if (poolsQuery.isLoading) {
    return <Loading.Page message="加载产品池..." />
  }

  return (
    <div className="min-h-[100dvh] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px] space-y-6">
        <header className="grid gap-6 border-b border-zinc-300 pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase text-[#0f766e]">
              <LinkSimple size={16} weight="bold" />
              Weighted short links
            </div>
            <h1 className="text-3xl font-extrabold text-zinc-950">产品池短链</h1>
            <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-zinc-600">
              一个产品池对应一个永久短链。系统识别 iOS 或 Android 后，按照人工设置的权重稳定分发。
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white shadow-[0_18px_36px_-26px_rgba(24,24,27,0.9)] hover:-translate-y-0.5 hover:bg-zinc-800 active:translate-y-0"
          >
            <Plus size={18} weight="bold" />
            新建产品池
          </button>
        </header>

        {feedback && (
          <div
            className={[
              'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-semibold animate-fade-in',
              feedback.type === 'success'
                ? 'border-[#a7d7ca] bg-[#edf8f4] text-[#115e59]'
                : 'border-rose-200 bg-rose-50 text-rose-800',
            ].join(' ')}
          >
            {feedback.type === 'success'
              ? <Check className="mt-0.5 shrink-0" size={18} weight="bold" />
              : <WarningCircle className="mt-0.5 shrink-0" size={18} weight="bold" />}
            <span>{feedback.message}</span>
          </div>
        )}

        {poolsQuery.isError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {poolsQuery.error instanceof Error ? poolsQuery.error.message : '产品池加载失败'}
          </div>
        )}

        {!poolsQuery.isError && pools.length === 0 ? (
          <Loading.Empty
            icon={(
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-[#e7f3ef] text-[#0f766e]">
                <LinkSimple size={28} weight="bold" />
              </div>
            )}
            title="还没有产品池"
            description="创建第一个产品池后，系统会自动生成永久短链。"
            action={{ label: '新建产品池', onClick: openCreateModal }}
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="self-start rounded-lg border border-zinc-200 bg-white shadow-[0_22px_48px_-36px_rgba(24,24,27,0.5)] lg:sticky lg:top-6">
              <div className="border-b border-zinc-200 px-4 py-4">
                <div className="text-sm font-extrabold text-zinc-950">产品池</div>
                <div className="mt-1 text-xs font-semibold text-zinc-500">{pools.length} 个短链入口</div>
              </div>
              <div className="max-h-[calc(100dvh-16rem)] space-y-1 overflow-y-auto p-2 app-scroll">
                {pools.map(pool => {
                  const active = pool._id === selectedPoolId
                  return (
                    <button
                      type="button"
                      key={pool._id}
                      onClick={() => {
                        setSelectedPoolId(pool._id)
                        setDraft(toDraft(pool))
                        setCopied(false)
                        setFeedback(null)
                      }}
                      className={[
                        'w-full rounded-lg border px-3 py-3 text-left transition-all active:scale-[0.99]',
                        active
                          ? 'border-zinc-900 bg-zinc-950 text-white'
                          : 'border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-zinc-50',
                      ].join(' ')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-bold">{pool.name}</span>
                        <span
                          className={[
                            'mt-0.5 h-2 w-2 shrink-0 rounded-full',
                            pool.status === 'active' ? 'bg-emerald-500' : 'bg-zinc-400',
                          ].join(' ')}
                        />
                      </div>
                      <div className={active ? 'mt-2 flex gap-3 text-xs text-zinc-300' : 'mt-2 flex gap-3 text-xs text-zinc-500'}>
                        <span>iOS {destinationCount(pool, 'ios')}</span>
                        <span>Android {destinationCount(pool, 'android')}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </aside>

            {draft && (
              <section className="min-w-0 space-y-5">
                <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_22px_48px_-36px_rgba(24,24,27,0.5)] sm:p-6">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                    <div className="min-w-0">
                      <label className="block text-xs font-bold text-zinc-600" htmlFor="pool-name">
                        产品池名称
                      </label>
                      <input
                        id="pool-name"
                        value={draft.name}
                        onChange={event => setDraft(current => current ? { ...current, name: event.target.value } : current)}
                        className={`${inputClassName} mt-2 max-w-xl text-base font-bold`}
                        maxLength={120}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => saveMutation.mutate(draft)}
                        disabled={saveMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#0f766e] px-4 py-2.5 text-sm font-bold text-white hover:-translate-y-0.5 hover:bg-[#115e59] active:translate-y-0"
                      >
                        {saveMutation.isPending
                          ? <Loading.Spinner size="sm" color="white" />
                          : <FloppyDisk size={18} weight="bold" />}
                        保存配置
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('删除后该短链会立即失效，确定删除吗？')) {
                            deleteMutation.mutate(draft._id)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3.5 py-2.5 text-sm font-bold text-rose-700 hover:bg-rose-50 active:scale-[0.98]"
                      >
                        <Trash size={17} weight="bold" />
                        删除
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 border-t border-zinc-200 pt-5 md:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)] md:items-end">
                    <div>
                      <label className="block text-xs font-bold text-zinc-600" htmlFor="short-link-domain">
                        投放域名
                      </label>
                      <select
                        id="short-link-domain"
                        value={draft.shortLinkDomain}
                        onChange={event => {
                          const shortLinkDomain = event.target.value
                          setDraft(current => current ? {
                            ...current,
                            shortLinkDomain,
                            shortUrl: buildShortUrl(shortLinkDomain, current.shortCode),
                          } : current)
                          setCopied(false)
                        }}
                        className={`${inputClassName} mt-2`}
                      >
                        {availableDomains.map(domain => (
                          <option key={domain.hostname} value={domain.hostname}>
                            {domain.label} · {domain.hostname}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="text-xs font-semibold leading-relaxed text-zinc-500">
                      短码永久不变。切换域名后保存即可更新默认投放链接；已接入域名都能继续访问同一个产品池。
                    </p>
                  </div>

                  <div className="mt-5">
                    <label className="block text-xs font-bold text-zinc-600" htmlFor="short-url">
                      当前投放短链
                    </label>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                      <input
                        id="short-url"
                        value={draft.shortUrl}
                        readOnly
                        className={`${inputClassName} font-mono text-xs`}
                      />
                      <button
                        type="button"
                        onClick={copyShortUrl}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-bold text-zinc-800 hover:bg-zinc-50 active:scale-[0.98]"
                      >
                        {copied ? <Check size={17} weight="bold" /> : <Copy size={17} weight="bold" />}
                        复制短链
                      </button>
                      <a
                        href={draft.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-zinc-700 hover:bg-zinc-50"
                        aria-label="打开短链"
                      >
                        <ArrowSquareOut size={18} weight="bold" />
                      </a>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-xs font-bold text-zinc-600" htmlFor="pool-status">
                        短链状态
                      </label>
                      <select
                        id="pool-status"
                        value={draft.status}
                        onChange={event => setDraft(current => current ? {
                          ...current,
                          status: event.target.value as ProductLinkPool['status'],
                        } : current)}
                        className={`${inputClassName} mt-2`}
                      >
                        <option value="active">启用</option>
                        <option value="inactive">停用</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-600" htmlFor="fallback-url">
                        兜底链接
                      </label>
                      <input
                        id="fallback-url"
                        value={draft.fallbackUrl || ''}
                        onChange={event => setDraft(current => current ? { ...current, fallbackUrl: event.target.value } : current)}
                        placeholder="桌面端或无可用 App 时跳转，可留空"
                        className={`${inputClassName} mt-2`}
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-lg border border-zinc-200 bg-white shadow-[0_22px_48px_-36px_rgba(24,24,27,0.5)]">
                  <div className="flex flex-col gap-4 border-b border-zinc-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div>
                      <h2 className="text-lg font-extrabold text-zinc-950">App 目标链接</h2>
                      <p className="mt-1 text-sm text-zinc-500">
                        iOS 与 Android 独立计算权重；权重为 0 或停用的链接不会获得流量。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => addDestination('ios')}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50 active:scale-[0.98]"
                      >
                        <AppleLogo size={17} weight="fill" />
                        添加 iOS
                      </button>
                      <button
                        type="button"
                        onClick={() => addDestination('android')}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50 active:scale-[0.98]"
                      >
                        <AndroidLogo size={17} weight="fill" />
                        添加 Android
                      </button>
                    </div>
                  </div>

                  {draft.destinations.length === 0 ? (
                    <Loading.Empty
                      icon={(
                        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
                          <DeviceMobile size={28} weight="bold" />
                        </div>
                      )}
                      title="产品池还没有 App 链接"
                      description="分别添加 iOS 或 Android 目标链接并设置权重。"
                      action={{ label: '添加 iOS 链接', onClick: () => addDestination('ios') }}
                    />
                  ) : (
                    <div className="divide-y divide-zinc-200">
                      {draft.destinations.map((destination, index) => {
                        const total = platformTotals[destination.platform]
                        const share = destination.enabled && total > 0
                          ? (destination.weight / total) * 100
                          : 0

                        return (
                          <article key={destination.clientId} className="px-5 py-5 sm:px-6">
                            <div className="grid gap-4 md:grid-cols-2 min-[1600px]:grid-cols-[minmax(150px,0.8fr)_130px_minmax(220px,1.6fr)_110px_90px_44px] min-[1600px]:items-end">
                              <div>
                                <label className="flex items-center gap-2 text-xs font-bold text-zinc-600" htmlFor={`destination-name-${destination.clientId}`}>
                                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
                                    {destination.platform === 'ios'
                                      ? <AppleLogo size={14} weight="fill" />
                                      : <AndroidLogo size={14} weight="fill" />}
                                  </span>
                                  App 名称
                                </label>
                                <input
                                  id={`destination-name-${destination.clientId}`}
                                  value={destination.name}
                                  onChange={event => updateDestination(destination.clientId, { name: event.target.value })}
                                  placeholder={`App ${index + 1}`}
                                  className={`${inputClassName} mt-2`}
                                  maxLength={120}
                                />
                              </div>

                              <div>
                                <label className="block text-xs font-bold text-zinc-600" htmlFor={`destination-platform-${destination.clientId}`}>
                                  平台
                                </label>
                                <select
                                  id={`destination-platform-${destination.clientId}`}
                                  value={destination.platform}
                                  onChange={event => updateDestination(destination.clientId, {
                                    platform: event.target.value as ProductLinkPlatform,
                                  })}
                                  className={`${inputClassName} mt-2`}
                                >
                                  <option value="ios">iOS</option>
                                  <option value="android">Android</option>
                                </select>
                              </div>

                              <div className="md:col-span-2 min-[1600px]:col-span-1">
                                <label className="block text-xs font-bold text-zinc-600" htmlFor={`destination-url-${destination.clientId}`}>
                                  目标链接
                                </label>
                                <input
                                  id={`destination-url-${destination.clientId}`}
                                  value={destination.url}
                                  onChange={event => updateDestination(destination.clientId, { url: event.target.value })}
                                  placeholder="https://..."
                                  className={`${inputClassName} mt-2 font-mono text-xs`}
                                />
                              </div>

                              <div>
                                <label className="flex items-center justify-between text-xs font-bold text-zinc-600" htmlFor={`destination-weight-${destination.clientId}`}>
                                  <span>权重</span>
                                  <span className="font-mono text-[#0f766e]">{share.toFixed(1)}%</span>
                                </label>
                                <input
                                  id={`destination-weight-${destination.clientId}`}
                                  type="number"
                                  min={0}
                                  max={1000}
                                  step={1}
                                  value={destination.weight}
                                  onChange={event => updateDestination(destination.clientId, {
                                    weight: Number(event.target.value),
                                  })}
                                  className={`${inputClassName} mt-2 font-mono`}
                                />
                              </div>

                              <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-bold text-zinc-700">
                                <input
                                  type="checkbox"
                                  checked={destination.enabled}
                                  onChange={event => updateDestination(destination.clientId, { enabled: event.target.checked })}
                                />
                                启用
                              </label>

                              <button
                                type="button"
                                onClick={() => removeDestination(destination.clientId)}
                                className="flex h-11 w-11 items-center justify-center justify-self-end rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 active:scale-[0.96]"
                                aria-label={`删除 ${destination.name || `App ${index + 1}`}`}
                              >
                                <Trash size={18} weight="bold" />
                              </button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              </section>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-pool-title"
        >
          <div className="w-full max-w-md rounded-lg border border-white/20 bg-white p-6 shadow-[0_30px_80px_-34px_rgba(24,24,27,0.7)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="create-pool-title" className="text-xl font-extrabold text-zinc-950">新建产品池</h2>
                <p className="mt-1 text-sm text-zinc-500">创建后自动生成永久短链。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-50"
                aria-label="关闭"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="mt-6">
              <label className="block text-sm font-bold text-zinc-700" htmlFor="new-pool-name">
                产品池名称
              </label>
              <input
                id="new-pool-name"
                autoFocus
                value={newPoolName}
                onChange={event => setNewPoolName(event.target.value)}
                onKeyDown={event => {
                  if (
                    event.key === 'Enter'
                    && newPoolName.trim()
                    && !createMutation.isPending
                  ) {
                    createMutation.mutate()
                  }
                }}
                placeholder="例如：Creative Studio 马甲包池"
                className={`${inputClassName} mt-2`}
                maxLength={120}
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-bold text-zinc-700" htmlFor="new-pool-domain">
                投放域名
              </label>
              <select
                id="new-pool-domain"
                value={newPoolDomain}
                onChange={event => setNewPoolDomain(event.target.value)}
                className={`${inputClassName} mt-2`}
              >
                {availableDomains.map(domain => (
                  <option key={domain.hostname} value={domain.hostname}>
                    {domain.label} · {domain.hostname}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs font-semibold leading-relaxed text-zinc-500">
                创建后仍可切换域名，短码和产品池不会变化。
              </p>
            </div>

            {createMutation.isError && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm font-semibold text-rose-800">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : '创建失败'}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 active:scale-[0.98]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={!newPoolName.trim() || createMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-zinc-800 active:scale-[0.98]"
              >
                {createMutation.isPending
                  ? <Loading.Spinner size="sm" color="white" />
                  : <Plus size={18} weight="bold" />}
                创建并生成短链
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
