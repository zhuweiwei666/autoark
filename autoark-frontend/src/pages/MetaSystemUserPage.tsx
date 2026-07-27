import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowsClockwise,
  Buildings,
  CheckCircle,
  Database,
  Key,
  LockKey,
  ShieldCheck,
  SpinnerGap,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  deactivateMetaCredential,
  discoverMetaBusinesses,
  getMetaBootstrapTokens,
  getMetaMigrationInventory,
  getMetaProvisionPlan,
  inspectMetaBusiness,
  provisionMetaSystemUser,
  validateMetaCredential,
  type BootstrapToken,
  type BusinessInventory,
  type MetaAsset,
  type MetaBusiness,
  type MigrationInventory,
  type ProvisionInput,
} from '../services/metaSystemUserApi'

const PROVISION_CONFIRMATION = 'PROVISION_SYSTEM_USER'

const formatDate = (value?: string) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN')
}

const normalizeAccountId = (value: string) => value.replace(/^act_/, '')

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)))
const isBootstrapTokenUsable = (token: BootstrapToken) => (
  token.status === 'active'
  && (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now())
)

type AssetSelectorProps = {
  title: string
  description: string
  assets: MetaAsset[]
  selected: string[]
  onChange: (ids: string[]) => void
}

function AssetSelector({
  title,
  description,
  assets,
  selected,
  onChange,
}: AssetSelectorProps) {
  const selectedSet = new Set(selected)
  const toggle = (assetId: string) => {
    onChange(
      selectedSet.has(assetId)
        ? selected.filter((id) => id !== assetId)
        : [...selected, assetId],
    )
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-extrabold text-zinc-950">{title}</h3>
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => onChange(assets.map((asset) => asset.assetId))}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-50"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-zinc-700 hover:bg-zinc-50"
          >
            清空
          </button>
        </div>
      </div>
      <div className="max-h-64 divide-y divide-zinc-100 overflow-y-auto">
        {assets.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            当前 BM 未返回此类资产
          </div>
        )}
        {assets.map((asset) => (
          <label
            key={asset.assetId}
            className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-zinc-50"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(asset.assetId)}
              onChange={() => toggle(asset.assetId)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-zinc-950"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-zinc-900">
                {asset.name || asset.assetId}
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                {asset.assetId}
                {asset.source ? ` · ${asset.source}` : ''}
                {asset.cachedAssignment?.operator
                  ? ` · ${asset.cachedAssignment.operator}`
                  : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
    </section>
  )
}

export default function MetaSystemUserPage() {
  const [migration, setMigration] = useState<MigrationInventory>()
  const [tokens, setTokens] = useState<BootstrapToken[]>([])
  const [businesses, setBusinesses] = useState<MetaBusiness[]>([])
  const [businessInventory, setBusinessInventory] = useState<BusinessInventory>()
  const [plan, setPlan] = useState<any>()
  const [result, setResult] = useState<any>()
  const [organizationId, setOrganizationId] = useState('')
  const [facebookAppId, setFacebookAppId] = useState('')
  const [bootstrapTokenId, setBootstrapTokenId] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [systemUserId, setSystemUserId] = useState('')
  const [systemUserName, setSystemUserName] = useState('')
  const [adAccountIds, setAdAccountIds] = useState<string[]>([])
  const [pageIds, setPageIds] = useState<string[]>([])
  const [pixelIds, setPixelIds] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  const loadBase = useCallback(async () => {
    setLoading('base')
    setError('')
    try {
      const [nextMigration, nextTokens] = await Promise.all([
        getMetaMigrationInventory(),
        getMetaBootstrapTokens(),
      ])
      setMigration(nextMigration)
      setTokens(nextTokens)
      setOrganizationId((current) => current || nextMigration.organizations[0]?.id || '')
      setFacebookAppId((current) => (
        current
        || nextMigration.apps.find((app) => app.isValid && app.enabledForBulkAds)?.id
        || nextMigration.apps[0]?.id
        || ''
      ))
      setBootstrapTokenId((current) => (
        current
        || nextTokens.find(isBootstrapTokenUsable)?.id
        || ''
      ))
    } catch (requestError: any) {
      setError(requestError.message || '加载迁移清单失败')
    } finally {
      setLoading('')
    }
  }, [])

  useEffect(() => {
    void loadBase()
  }, [loadBase])

  const organization = useMemo(
    () => migration?.organizations.find((item) => item.id === organizationId),
    [migration, organizationId],
  )
  const activeCredentials = migration?.organizations.flatMap(
    (item) => item.credentials.filter((credential) => credential.status === 'active'),
  ) || []
  const totalCredentialCount = migration?.organizations.reduce(
    (count, item) => count + item.credentials.length,
    0,
  ) || 0
  const migratedOrganizationCount = migration?.organizations.filter(
    (item) => item.credentials.some((credential) => credential.status === 'active'),
  ).length || 0
  const activeTokens = tokens.filter(isBootstrapTokenUsable)

  const resetBusinessSelection = () => {
    setBusinesses([])
    setBusinessId('')
    setBusinessInventory(undefined)
    setPlan(undefined)
    setResult(undefined)
    setSystemUserId('')
    setAdAccountIds([])
    setPageIds([])
    setPixelIds([])
    setConfirmation('')
  }

  const handleDiscoverBusinesses = async () => {
    if (!bootstrapTokenId) return
    setLoading('businesses')
    setError('')
    resetBusinessSelection()
    try {
      const discovered = await discoverMetaBusinesses(bootstrapTokenId)
      setBusinesses(discovered)
      setBusinessId(discovered[0]?.id || '')
    } catch (requestError: any) {
      setError(requestError.message || '发现 BM 失败')
    } finally {
      setLoading('')
    }
  }

  const handleInspectBusiness = async () => {
    if (!bootstrapTokenId || !businessId || !organization) return
    setLoading('inventory')
    setError('')
    setPlan(undefined)
    setResult(undefined)
    try {
      const inspected = await inspectMetaBusiness(bootstrapTokenId, businessId)
      setBusinessInventory(inspected)

      const visibleAppIds = new Set(inspected.assets.apps.map((asset) => asset.assetId))
      const compatibleApp = migration?.apps.find(
        (app) => app.isValid && visibleAppIds.has(app.appId),
      )
      if (compatibleApp) setFacebookAppId(compatibleApp.id)

      const recommendedAccounts = new Set(
        organization.suggestedAssets.adAccounts.map((asset) => normalizeAccountId(asset.assetId)),
      )
      const recommendedPages = new Set(
        organization.suggestedAssets.pages.map((asset) => asset.assetId),
      )
      const recommendedPixels = new Set(
        organization.suggestedAssets.pixels.map((asset) => asset.assetId),
      )
      setAdAccountIds(inspected.assets.adAccounts
        .filter((asset) => (
          asset.cachedAssignment?.organizationId === organization.id
          || recommendedAccounts.has(normalizeAccountId(asset.assetId))
        ))
        .map((asset) => normalizeAccountId(asset.assetId)))
      setPageIds(inspected.assets.pages
        .filter((asset) => recommendedPages.has(asset.assetId))
        .map((asset) => asset.assetId))
      setPixelIds(inspected.assets.pixels
        .filter((asset) => recommendedPixels.has(asset.assetId))
        .map((asset) => asset.assetId))

      const existingCredential = organization.credentials.find(
        (credential) => credential.businessId === businessId,
      )
      const matchingSystemUser = inspected.systemUsers.find(
        (systemUser) => (
          systemUser.role === 'EMPLOYEE'
          && systemUser.id === existingCredential?.systemUserId
        ),
      ) || inspected.systemUsers.find(
        (systemUser) => (
          systemUser.role === 'EMPLOYEE'
          && systemUser.name === `AutoArk Publisher ${organization.name}`
        ),
      )
      setSystemUserId(matchingSystemUser?.id || '')
      setSystemUserName(`AutoArk Publisher ${organization.name}`.slice(0, 120))
    } catch (requestError: any) {
      setError(requestError.message || '读取 BM 资产失败')
    } finally {
      setLoading('')
    }
  }

  const buildInput = (): ProvisionInput => {
    if (!organizationId || !facebookAppId || !bootstrapTokenId || !businessId) {
      throw new Error('请先选择组织、App、超级管理员授权和 BM')
    }
    const selectedAccountSet = new Set(adAccountIds.map(normalizeAccountId))
    const pixelSuggestions = new Map(
      (organization?.suggestedAssets.pixels || []).map((pixel) => [
        pixel.assetId,
        pixel.accountIds || [],
      ]),
    )
    return {
      organizationId,
      facebookAppId,
      bootstrapTokenId,
      businessId,
      systemUserId: systemUserId || undefined,
      systemUserName: systemUserId ? undefined : systemUserName,
      isDefault: true,
      assets: {
        adAccountIds: unique(adAccountIds.map(normalizeAccountId)),
        pageIds: unique(pageIds),
        pixels: unique(pixelIds).map((assetId) => {
          const suggestedAccounts = (pixelSuggestions.get(assetId) || [])
            .map(normalizeAccountId)
            .filter((accountId) => selectedAccountSet.has(accountId))
          return {
            assetId,
            accountIds: suggestedAccounts.length > 0
              ? unique(suggestedAccounts)
              : Array.from(selectedAccountSet),
          }
        }),
      },
    }
  }

  const handlePlan = async () => {
    setLoading('plan')
    setError('')
    setResult(undefined)
    try {
      const nextPlan = await getMetaProvisionPlan(buildInput())
      setPlan(nextPlan)
      setConfirmation('')
    } catch (requestError: any) {
      setError(requestError.message || '生成执行计划失败')
    } finally {
      setLoading('')
    }
  }

  const handleProvision = async () => {
    if (confirmation !== PROVISION_CONFIRMATION) return
    setLoading('provision')
    setError('')
    try {
      const provisioned = await provisionMetaSystemUser(buildInput())
      setResult(provisioned)
      setPlan(undefined)
      setConfirmation('')
      await loadBase()
    } catch (requestError: any) {
      setError(requestError.message || 'System User 授权失败')
    } finally {
      setLoading('')
    }
  }

  const handleValidate = async (credentialId: string) => {
    setLoading(`validate:${credentialId}`)
    setError('')
    try {
      await validateMetaCredential(credentialId)
      await loadBase()
    } catch (requestError: any) {
      setError(requestError.message || '凭证验证失败')
    } finally {
      setLoading('')
    }
  }

  const handleDeactivate = async (credentialId: string) => {
    const typed = window.prompt(
      '此操作只停用 AutoArk 内的凭证，不会删除 Meta 资产授权。请输入 DEACTIVATE_SYSTEM_USER_CREDENTIAL 确认。',
    )
    if (typed !== 'DEACTIVATE_SYSTEM_USER_CREDENTIAL') return
    setLoading(`deactivate:${credentialId}`)
    setError('')
    try {
      await deactivateMetaCredential(credentialId)
      await loadBase()
    } catch (requestError: any) {
      setError(requestError.message || '停用凭证失败')
    } finally {
      setLoading('')
    }
  }

  const selectedApp = migration?.apps.find((app) => app.id === facebookAppId)
  const appVisibleInBusiness = Boolean(
    selectedApp
    && businessInventory?.assets.apps.some((asset) => asset.assetId === selectedApp.appId),
  )

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="rounded-2xl border border-zinc-200 bg-zinc-950 p-6 text-white shadow-xl shadow-zinc-950/10">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
              <ShieldCheck size={20} weight="fill" />
              Meta Business IAM
            </div>
            <h1 className="mt-3 text-2xl font-black sm:text-3xl">
              System User 资产授权
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              个人超级管理员 token 仅用于一次性发现 BM、分配资产和签发凭证；发广告、启停和调预算由组织级 System User 执行。凭证只在服务端加密保存，不下发浏览器。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadBase()}
            disabled={Boolean(loading)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 disabled:opacity-50"
          >
            <ArrowsClockwise size={18} className={loading === 'base' ? 'animate-spin' : ''} />
            刷新清单
          </button>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          {
            label: '已迁移组织',
            value: migratedOrganizationCount,
            detail: `共 ${migration?.organizations.length || 0} 个组织`,
            icon: ShieldCheck,
          },
          {
            label: '有效 System User 凭证',
            value: activeCredentials.length,
            detail: '发布与调优优先使用',
            icon: LockKey,
          },
          {
            label: '可用引导授权',
            value: activeTokens.length,
            detail: '仅用于 BM IAM 操作',
            icon: Key,
          },
        ].map((card) => {
          const Icon = card.icon
          return (
            <div key={card.label} className="rounded-xl border border-zinc-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-zinc-600">{card.label}</span>
                <Icon size={20} className="text-zinc-500" />
              </div>
              <div className="mt-3 text-3xl font-black text-zinc-950">{card.value}</div>
              <div className="mt-1 text-xs text-zinc-500">{card.detail}</div>
            </div>
          )
        })}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <CheckCircle size={21} weight="fill" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-extrabold">System User 凭证已签发并完成资产读回验证</div>
            <div className="mt-1 text-xs">
              指纹 {result?.credential?.tokenFingerprint || '—'} · 已验证资产{' '}
              {result?.readback?.assignedAssetCount ?? '—'} 个
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white">
            <Buildings size={21} weight="fill" />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-950">1. 选择组织与引导身份</h2>
            <p className="text-xs text-zinc-500">这里不会把个人 token 分发给普通用户。</p>
          </div>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <label className="text-sm font-bold text-zinc-700">
            AutoArk 组织
            <select
              value={organizationId}
              onChange={(event) => {
                setOrganizationId(event.target.value)
                resetBusinessSelection()
              }}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm"
            >
              {(migration?.organizations || []).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-zinc-700">
            Facebook App
            <select
              value={facebookAppId}
              onChange={(event) => {
                setFacebookAppId(event.target.value)
                setPlan(undefined)
              }}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm"
            >
              {(migration?.apps || []).map((app) => (
                <option key={app.id} value={app.id}>
                  {app.appName} ({app.appId}){app.isValid ? '' : ' · 凭证无效'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-bold text-zinc-700">
            超级管理员个人授权
            <select
              value={bootstrapTokenId}
              onChange={(event) => {
                setBootstrapTokenId(event.target.value)
                resetBusinessSelection()
              }}
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm"
            >
              {tokens.map((token) => (
                <option key={token.id} value={token.id} disabled={!isBootstrapTokenUsable(token)}>
                  {token.fbUserName || token.optimizer || token.fbUserId || token.id}
                  {isBootstrapTokenUsable(token) ? '' : ` · ${token.status === 'active' ? 'expired' : token.status}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDiscoverBusinesses()}
            disabled={!bootstrapTokenId || Boolean(loading)}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
          >
            {loading === 'businesses' && <SpinnerGap size={18} className="animate-spin" />}
            发现可管理 BM
          </button>
          <span className="text-xs text-zinc-500">
            个人授权有效期：{formatDate(tokens.find((token) => token.id === bootstrapTokenId)?.expiresAt)}
          </span>
        </div>
      </section>

      {businesses.length > 0 && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-black text-zinc-950">2. 读取 BM 资产</h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <select
              value={businessId}
              onChange={(event) => {
                setBusinessId(event.target.value)
                setBusinessInventory(undefined)
                setPlan(undefined)
              }}
              className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm"
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name || business.id} · {business.verificationStatus || 'verification unknown'}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleInspectBusiness()}
              disabled={!businessId || Boolean(loading)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
            >
              {loading === 'inventory' && <SpinnerGap size={18} className="animate-spin" />}
              读取并自动匹配资产
            </button>
          </div>
        </section>
      )}

      {businessInventory && (
        <>
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-zinc-950">3. System User 与资产范围</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  已按 AutoArk 组织账户和历史授权快照预选，可在执行前逐项核对。
                </p>
              </div>
              <span className={[
                'rounded-lg px-3 py-1.5 text-xs font-extrabold',
                appVisibleInBusiness
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800',
              ].join(' ')}>
                {appVisibleInBusiness ? 'App 已关联此 BM' : '所选 App 未出现在此 BM'}
              </span>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="text-sm font-bold text-zinc-700">
                复用已有 System User（留空则创建）
                <select
                  value={systemUserId}
                  onChange={(event) => {
                    setSystemUserId(event.target.value)
                    setPlan(undefined)
                  }}
                  className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="">创建新的 EMPLOYEE System User</option>
                  {businessInventory.systemUsers
                    .filter((systemUser) => systemUser.role === 'EMPLOYEE')
                    .map((systemUser) => (
                    <option key={systemUser.id} value={systemUser.id}>
                      {systemUser.name || systemUser.id} · {systemUser.role || 'role unknown'}
                    </option>
                    ))}
                </select>
              </label>
              <label className="text-sm font-bold text-zinc-700">
                新 System User 名称
                <input
                  value={systemUserName}
                  onChange={(event) => setSystemUserName(event.target.value)}
                  disabled={Boolean(systemUserId)}
                  maxLength={120}
                  className="mt-2 w-full rounded-xl border border-zinc-300 px-3 py-2.5 text-sm disabled:bg-zinc-100"
                />
              </label>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-3">
              <AssetSelector
                title={`广告账户 · ${adAccountIds.length}/${businessInventory.assets.adAccounts.length}`}
                description="用于创建广告、启停和调预算"
                assets={businessInventory.assets.adAccounts.map((asset) => ({
                  ...asset,
                  assetId: normalizeAccountId(asset.assetId),
                }))}
                selected={adAccountIds}
                onChange={(ids) => {
                  setAdAccountIds(ids.map(normalizeAccountId))
                  setPlan(undefined)
                }}
              />
              <AssetSelector
                title={`主页 · ${pageIds.length}/${businessInventory.assets.pages.length}`}
                description="仅授予 ADVERTISE 与 ANALYZE"
                assets={businessInventory.assets.pages}
                selected={pageIds}
                onChange={(ids) => {
                  setPageIds(ids)
                  setPlan(undefined)
                }}
              />
              <AssetSelector
                title={`像素 · ${pixelIds.length}/${businessInventory.assets.pixels.length}`}
                description="不授予 BM 管理或财务权限"
                assets={businessInventory.assets.pixels}
                selected={pixelIds}
                onChange={(ids) => {
                  setPixelIds(ids)
                  setPlan(undefined)
                }}
              />
            </div>

            {businessInventory.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                <div className="font-extrabold">部分 BM 边读取失败</div>
                {businessInventory.warnings.map((warning, index) => (
                  <div key={`${warning.edge}-${index}`} className="mt-1">
                    {warning.edge}: {warning.message || `code ${warning.code || 'unknown'}`}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handlePlan()}
              disabled={
                Boolean(loading)
                || !appVisibleInBusiness
                || adAccountIds.length + pageIds.length + pixelIds.length === 0
              }
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-40"
            >
              {loading === 'plan' && <SpinnerGap size={18} className="animate-spin" />}
              生成只读执行计划
            </button>
          </section>

          {plan && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <WarningCircle size={24} weight="fill" className="mt-0.5 shrink-0 text-amber-700" />
                <div>
                  <h2 className="text-lg font-black text-amber-950">4. 确认 Meta IAM 变更</h2>
                  <p className="mt-1 text-sm text-amber-900">
                    {plan.willCreateSystemUser ? '将创建 1 个 EMPLOYEE System User；' : '将复用已有 System User；'}
                    将新增 {plan.mutations?.assignAssetCount || 0} 项资产授权，
                    {plan.mutations?.generateAccessToken ? '并签发新 token。' : '已有有效 token 将复用。'}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(plan.desiredAssets || []).map((asset: any) => (
                  <div key={`${asset.kind}:${asset.assetId}`} className="rounded-lg border border-amber-200 bg-white/80 px-3 py-2 text-xs">
                    <div className="font-extrabold text-zinc-900">{asset.name || asset.assetId}</div>
                    <div className="mt-1 text-zinc-600">
                      {asset.kind} · {asset.action === 'assign' ? '新增授权' : '已授权'}
                    </div>
                    <div className="mt-1 text-zinc-500">{(asset.tasks || []).join(', ')}</div>
                  </div>
                ))}
              </div>
              <label className="mt-5 block text-sm font-extrabold text-amber-950">
                输入 {PROVISION_CONFIRMATION} 执行
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-amber-300 bg-white px-3 py-2.5 font-mono text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => void handleProvision()}
                disabled={confirmation !== PROVISION_CONFIRMATION || Boolean(loading)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-amber-900 px-5 py-3 text-sm font-extrabold text-white disabled:opacity-40"
              >
                {loading === 'provision' && <SpinnerGap size={18} className="animate-spin" />}
                执行授权并读回验证
              </button>
            </section>
          )}
        </>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <Database size={22} className="text-zinc-700" />
          <div>
            <h2 className="text-lg font-black text-zinc-950">现有组织凭证</h2>
            <p className="text-xs text-zinc-500">页面永不展示原始 token，只展示不可逆指纹。</p>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="text-xs font-extrabold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-3">组织 / BM</th>
                <th className="px-3 py-3">System User</th>
                <th className="px-3 py-3">资产</th>
                <th className="px-3 py-3">状态</th>
                <th className="px-3 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(migration?.organizations || []).flatMap((item) => (
                item.credentials.map((credential) => (
                  <tr key={credential.id}>
                    <td className="px-3 py-3">
                      <div className="font-bold text-zinc-900">{item.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {credential.businessName || credential.businessId}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-bold text-zinc-900">{credential.systemUserName}</div>
                      <div className="mt-1 font-mono text-[11px] text-zinc-500">
                        {credential.tokenFingerprint}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-600">
                      账户 {credential.assetCounts.adAccounts} · 主页 {credential.assetCounts.pages} · 像素 {credential.assetCounts.pixels}
                    </td>
                    <td className="px-3 py-3">
                      <span className={[
                        'rounded-lg px-2.5 py-1 text-xs font-extrabold',
                        credential.status === 'active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-zinc-100 text-zinc-700',
                      ].join(' ')}>
                        {credential.status}
                      </span>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {formatDate(credential.lastValidatedAt)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleValidate(credential.id)}
                          disabled={Boolean(loading)}
                          className="rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-bold hover:bg-zinc-50 disabled:opacity-40"
                        >
                          {loading === `validate:${credential.id}` ? '验证中' : '验证'}
                        </button>
                        {credential.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => void handleDeactivate(credential.id)}
                            disabled={Boolean(loading)}
                            className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                          >
                            停用
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ))}
              {totalCredentialCount === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-zinc-500">
                    尚未创建组织级 System User 凭证
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
