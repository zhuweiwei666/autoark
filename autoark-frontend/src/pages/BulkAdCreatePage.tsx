import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const API_BASE = '/api'

const STEPS = [
  { id: 1, title: '基本配置', description: '登录授权、选择账户' },
  { id: 2, title: '广告系列', description: '名称、预算、竞价策略' },
  { id: 3, title: '广告组', description: '定向、版位、排期' },
  { id: 4, title: '广告创意', description: '素材、文案、格式' },
  { id: 5, title: '预览发布', description: '确认并发布' },
]

interface AccountConfig {
  accountId: string
  accountName: string
  pageId: string
  pageName: string
  pixelId: string
  pixelName: string
  conversionEvent: string
}

interface AuthStatus {
  authorized: boolean
  fbUserId?: string
  fbUserName?: string
  tokenId?: string
}

export default function BulkAdCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // 授权状态
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  
  // 账户资产
  const [accounts, setAccounts] = useState<any[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [pages, setPages] = useState<any[]>([])
  const [pixels, setPixels] = useState<any[]>([])
  
  // 资产包
  const [targetingPackages, setTargetingPackages] = useState<any[]>([])
  const [copywritingPackages, setCopywritingPackages] = useState<any[]>([])
  const [creativeGroups, setCreativeGroups] = useState<any[]>([])

  // 表单数据
  const [selectedAccounts, setSelectedAccounts] = useState<AccountConfig[]>([])
  const [campaign, setCampaign] = useState({
    nameTemplate: '{accountName}_{date}',
    status: 'PAUSED',
    objective: 'OUTCOME_SALES',
    budgetOptimization: true,
    budgetType: 'DAILY',
    budget: 50,
    bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
  })
  const [adset, setAdset] = useState({
    nameTemplate: '{campaignName}_adset',
    status: 'PAUSED',
    targetingPackageId: '',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    billingEvent: 'IMPRESSIONS',
    placementType: 'AUTOMATIC',
  })
  const [ad, setAd] = useState({
    nameTemplate: '{adsetName}_ad_{index}',
    status: 'PAUSED',
    creativeGroupIds: [] as string[],
    copywritingPackageIds: [] as string[],
    format: 'SINGLE',
  })
  const [publishStrategy, setPublishStrategy] = useState({
    targetingLevel: 'ADSET',
    creativeLevel: 'ADSET',
    copywritingMode: 'SHARED',
    schedule: 'IMMEDIATE',
  })
  
  // 检查 URL 参数（OAuth 回调）
  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')
    
    if (oauthSuccess === 'true') {
      // 登录成功，刷新授权状态
      checkAuthStatus()
    }
    if (oauthError) {
      setError(decodeURIComponent(oauthError))
    }
  }, [searchParams])
  
  // 初始化
  useEffect(() => {
    checkAuthStatus()
    loadAssets()
  }, [])
  
  // 检查授权状态
  const checkAuthStatus = async () => {
    setAuthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/auth/status`)
      const data = await res.json()
      if (data.success) {
        setAuthStatus(data.data)
        // 如果已授权，自动加载账户
        if (data.data.authorized) {
          loadAdAccounts()
        }
      }
    } catch (err) {
      console.error('Failed to check auth status:', err)
      setAuthStatus({ authorized: false })
    } finally {
      setAuthLoading(false)
    }
  }
  
  // Facebook 登录
  const handleFacebookLogin = async () => {
    setLoginLoading(true)
    try {
      // 使用原有 OAuth 服务，通过 state 参数标记来源
      const res = await fetch(`${API_BASE}/facebook/oauth/login-url?state=bulk-ad`)
      const data = await res.json()
      if (data.success && data.data.loginUrl) {
        // 跳转到 Facebook 授权页面
        window.location.href = data.data.loginUrl
      } else {
        setError(data.error || '获取登录链接失败')
      }
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoginLoading(false)
    }
  }
  
  // 加载广告账户
  const loadAdAccounts = async () => {
    setAccountsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/auth/ad-accounts`)
      const data = await res.json()
      if (data.success) {
        setAccounts(data.data || [])
      }
    } catch (err) {
      console.error('Failed to load ad accounts:', err)
    } finally {
      setAccountsLoading(false)
    }
  }
  
  // 加载账户的 Pages 和 Pixels
  const loadAccountAssets = async (accountId: string) => {
    try {
      const [pagesRes, pixelsRes] = await Promise.all([
        fetch(`${API_BASE}/bulk-ad/auth/pages?accountId=${accountId}`),
        fetch(`${API_BASE}/bulk-ad/auth/pixels?accountId=${accountId}`),
      ])
      const pagesData = await pagesRes.json()
      const pixelsData = await pixelsRes.json()
      if (pagesData.success) setPages(pagesData.data || [])
      if (pixelsData.success) setPixels(pixelsData.data || [])
    } catch (err) {
      console.error('Failed to load account assets:', err)
    }
  }
  
  // 加载资产包
  const loadAssets = async () => {
    try {
      const [tpRes, cpRes, cgRes] = await Promise.all([
        fetch(`${API_BASE}/bulk-ad/targeting-packages`),
        fetch(`${API_BASE}/bulk-ad/copywriting-packages`),
        fetch(`${API_BASE}/bulk-ad/creative-groups`),
      ])
      const tpData = await tpRes.json()
      const cpData = await cpRes.json()
      const cgData = await cgRes.json()
      if (tpData.success) setTargetingPackages(tpData.data?.list || [])
      if (cpData.success) setCopywritingPackages(cpData.data?.list || [])
      if (cgData.success) setCreativeGroups(cgData.data?.list || [])
    } catch (err) {
      console.error('Failed to load assets:', err)
    }
  }
  
  // 选择/取消选择账户
  const toggleAccount = (account: any) => {
    const accountId = account.account_id || account.id?.replace('act_', '')
    const exists = selectedAccounts.find(a => a.accountId === accountId)
    if (exists) {
      setSelectedAccounts(selectedAccounts.filter(a => a.accountId !== accountId))
    } else {
      setSelectedAccounts([...selectedAccounts, {
        accountId: accountId,
        accountName: account.name || accountId,
        pageId: '', pageName: '', pixelId: '', pixelName: '', conversionEvent: 'PURCHASE',
      }])
    }
  }
  
  // 更新账户配置
  const updateAccountConfig = (accountId: string, field: string, value: string) => {
    setSelectedAccounts(selectedAccounts.map(a => 
      a.accountId === accountId ? { ...a, [field]: value } : a
    ))
  }
  
  // 发布
  const handlePublish = async () => {
    setLoading(true)
    setError(null)
    try {
      const draft = {
        name: `批量广告_${new Date().toISOString().slice(0, 10)}`,
        accounts: selectedAccounts,
        campaign, adset, ad,
        publishStrategy,
      }
      const createRes = await fetch(`${API_BASE}/bulk-ad/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const createData = await createRes.json()
      if (!createData.success) throw new Error(createData.error || '创建草稿失败')
      
      const draftId = createData.data._id
      const validateRes = await fetch(`${API_BASE}/bulk-ad/drafts/${draftId}/validate`, { method: 'POST' })
      const validateData = await validateRes.json()
      if (!validateData.success || !validateData.data.isValid) {
        throw new Error(`验证失败: ${validateData.data?.errors?.map((e: any) => e.message).join(', ')}`)
      }
      
      const publishRes = await fetch(`${API_BASE}/bulk-ad/drafts/${draftId}/publish`, { method: 'POST' })
      const publishData = await publishRes.json()
      if (!publishData.success) throw new Error(publishData.error || '发布失败')
      
      navigate(`/bulk-ad/tasks?taskId=${publishData.data._id}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  
  // 预估数据
  const estimates = {
    totalAccounts: selectedAccounts.length,
    totalCampaigns: selectedAccounts.length,
    totalAdsets: selectedAccounts.length,
    totalAds: selectedAccounts.length * Math.max(1, ad.creativeGroupIds.length) * 
      (publishStrategy.copywritingMode === 'SEQUENTIAL' ? Math.max(1, ad.copywritingPackageIds.length) : 1),
    dailyBudget: campaign.budget * selectedAccounts.length,
  }
  
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">批量创建广告</h1>
          <p className="text-slate-500 mt-1">按照步骤配置并批量创建 Facebook 广告</p>
        </div>
        
        {/* 错误提示 */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}
        
        {/* Steps indicator */}
        <div className="mb-8 flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold ${
                currentStep === step.id ? 'bg-blue-600 text-white' :
                currentStep > step.id ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                {currentStep > step.id ? '✓' : step.id}
              </div>
              <div className="ml-3 hidden md:block">
                <div className={`font-medium ${currentStep === step.id ? 'text-blue-600' : 'text-slate-700'}`}>{step.title}</div>
                <div className="text-xs text-slate-500">{step.description}</div>
              </div>
              {index < STEPS.length - 1 && <div className={`w-12 h-1 mx-4 rounded ${currentStep > step.id ? 'bg-green-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
        
        {/* Step content */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 min-h-[400px]">
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* 授权状态检查 */}
              {authLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                  <p className="text-slate-500">检查授权状态...</p>
                </div>
              ) : !authStatus?.authorized ? (
                // 未授权 - 显示登录按钮
                <div className="text-center py-12">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">登录 Facebook 授权</h3>
                  <p className="text-slate-500 mb-6 max-w-md mx-auto">
                    点击下方按钮登录 Facebook，授权后即可获取您的广告账户、主页和 Pixel
                  </p>
                  <button
                    onClick={handleFacebookLogin}
                    disabled={loginLoading}
                    className="inline-flex items-center gap-3 px-8 py-4 bg-[#1877F2] text-white rounded-xl hover:bg-[#166FE5] transition-colors text-lg font-medium disabled:opacity-50"
                  >
                    {loginLoading ? (
                      <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
                    ) : (
                      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    )}
                    使用 Facebook 登录
                  </button>
                </div>
              ) : (
                // 已授权 - 显示账户选择
                <>
                  {/* 当前授权用户信息 */}
                  <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-green-800">已授权 Facebook 账号</div>
                        <div className="text-sm text-green-600">{authStatus.fbUserName} ({authStatus.fbUserId})</div>
                      </div>
                    </div>
                    <button
                      onClick={handleFacebookLogin}
                      className="text-sm text-green-600 hover:text-green-800 underline"
                    >
                      切换账号
                    </button>
                  </div>
                  
                  <h3 className="text-lg font-semibold">选择投放账户</h3>
                  
                  {accountsLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                      <p className="text-slate-500">加载广告账户...</p>
                    </div>
                  ) : accounts.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <p>未找到广告账户，请确保您的 Facebook 账号有权限访问广告账户</p>
                      <button onClick={loadAdAccounts} className="mt-3 text-blue-500 hover:underline">重新加载</button>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        {accounts.map(account => {
                          const accountId = account.account_id || account.id?.replace('act_', '')
                          return (
                            <label key={accountId} className={`flex items-center p-4 border rounded-lg cursor-pointer transition-colors ${
                              selectedAccounts.find(a => a.accountId === accountId) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                            }`}>
                              <input type="checkbox" checked={!!selectedAccounts.find(a => a.accountId === accountId)} onChange={() => toggleAccount(account)} className="mr-3" />
                              <div className="flex-1">
                                <div className="font-medium">{account.name || accountId}</div>
                                <div className="text-sm text-slate-500">{accountId}</div>
                              </div>
                              {account.account_status === 1 && <span className="text-xs px-2 py-1 bg-green-100 text-green-600 rounded">活跃</span>}
                            </label>
                          )
                        })}
                      </div>
                      
                      {selectedAccounts.length > 0 && (
                        <div className="space-y-4 mt-6">
                          <h4 className="font-semibold">配置选中的账户</h4>
                          {selectedAccounts.map(acc => (
                            <div key={acc.accountId} className="p-4 border rounded-lg">
                              <div className="font-medium text-slate-700 mb-3">{acc.accountName}</div>
                              <div className="grid grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">Facebook 主页 *</label>
                                  <select 
                                    value={acc.pageId} 
                                    onChange={(e) => updateAccountConfig(acc.accountId, 'pageId', e.target.value)} 
                                    onFocus={() => loadAccountAssets(acc.accountId)} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                  >
                                    <option value="">选择主页</option>
                                    {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">Pixel</label>
                                  <select 
                                    value={acc.pixelId} 
                                    onChange={(e) => updateAccountConfig(acc.accountId, 'pixelId', e.target.value)} 
                                    onFocus={() => loadAccountAssets(acc.accountId)} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                  >
                                    <option value="">选择 Pixel</option>
                                    {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">转化事件</label>
                                  <select 
                                    value={acc.conversionEvent} 
                                    onChange={(e) => updateAccountConfig(acc.accountId, 'conversionEvent', e.target.value)} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                  >
                                    <option value="PURCHASE">Purchase</option>
                                    <option value="ADD_TO_CART">Add to Cart</option>
                                    <option value="INITIATE_CHECKOUT">Initiate Checkout</option>
                                    <option value="LEAD">Lead</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
          
          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告系列设置</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">系列名称模板</label>
                  <input type="text" value={campaign.nameTemplate} onChange={(e) => setCampaign({...campaign, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" />
                  <p className="text-xs text-slate-400 mt-1">支持变量: {'{accountName}'}, {'{date}'}</p></div>
                <div><label className="block text-sm text-slate-600 mb-1">推广目标</label>
                  <select value={campaign.objective} onChange={(e) => setCampaign({...campaign, objective: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="OUTCOME_SALES">销量</option><option value="OUTCOME_LEADS">潜在客户</option><option value="OUTCOME_TRAFFIC">流量</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">预算类型</label>
                  <select value={campaign.budgetType} onChange={(e) => setCampaign({...campaign, budgetType: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="DAILY">日预算</option><option value="LIFETIME">总预算</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">预算金额 ($)</label>
                  <input type="number" value={campaign.budget} onChange={(e) => setCampaign({...campaign, budget: Number(e.target.value)})} min="1" className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">竞价策略</label>
                  <select value={campaign.bidStrategy} onChange={(e) => setCampaign({...campaign, bidStrategy: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="LOWEST_COST_WITHOUT_CAP">最低成本</option><option value="COST_CAP">费用上限</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={campaign.status} onChange={(e) => setCampaign({...campaign, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="PAUSED">暂停</option><option value="ACTIVE">启用</option>
                  </select></div>
              </div>
            </div>
          )}
          
          {currentStep === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告组设置</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">广告组名称模板</label>
                  <input type="text" value={adset.nameTemplate} onChange={(e) => setAdset({...adset, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">定向包</label>
                  <select value={adset.targetingPackageId} onChange={(e) => setAdset({...adset, targetingPackageId: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="">选择定向包</option>{targetingPackages.map(pkg => <option key={pkg._id} value={pkg._id}>{pkg.name}</option>)}
                  </select>
                  <button onClick={() => navigate('/bulk-ad/assets?tab=targeting')} className="text-xs text-blue-500 mt-1 hover:underline">+ 新建定向包</button></div>
                <div><label className="block text-sm text-slate-600 mb-1">优化目标</label>
                  <select value={adset.optimizationGoal} onChange={(e) => setAdset({...adset, optimizationGoal: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="OFFSITE_CONVERSIONS">网站转化</option><option value="VALUE">转化价值</option><option value="LINK_CLICKS">链接点击</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">版位设置</label>
                  <select value={adset.placementType} onChange={(e) => setAdset({...adset, placementType: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="AUTOMATIC">自动版位（推荐）</option><option value="MANUAL">手动版位</option>
                  </select></div>
              </div>
            </div>
          )}
          
          {currentStep === 4 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告创意设置</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">广告名称模板</label>
                  <input type="text" value={ad.nameTemplate} onChange={(e) => setAd({...ad, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">广告格式</label>
                  <select value={ad.format} onChange={(e) => setAd({...ad, format: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="SINGLE">单图/视频</option><option value="CAROUSEL">轮播</option>
                  </select></div>
              </div>
              <div><label className="block text-sm text-slate-600 mb-2">选择创意组</label>
                {creativeGroups.length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed rounded-lg">
                    <p className="text-slate-500 mb-2">还没有创意组</p>
                    <button onClick={() => navigate('/bulk-ad/assets?tab=creative')} className="text-blue-500 hover:underline">+ 新建创意组</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {creativeGroups.map(group => (
                      <label key={group._id} className={`flex items-center p-3 border rounded-lg cursor-pointer ${ad.creativeGroupIds.includes(group._id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                        <input type="checkbox" checked={ad.creativeGroupIds.includes(group._id)} onChange={(e) => setAd({...ad, creativeGroupIds: e.target.checked ? [...ad.creativeGroupIds, group._id] : ad.creativeGroupIds.filter(id => id !== group._id)})} className="mr-2" />
                        <div><div className="font-medium text-sm">{group.name}</div><div className="text-xs text-slate-500">{group.materialStats?.totalCount || 0} 个素材</div></div>
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={() => navigate('/bulk-ad/assets?tab=creative')} className="text-sm text-blue-500 mt-2 hover:underline">+ 新建创意组</button></div>
              <div><label className="block text-sm text-slate-600 mb-2">选择文案包</label>
                {copywritingPackages.length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed rounded-lg">
                    <p className="text-slate-500 mb-2">还没有文案包</p>
                    <button onClick={() => navigate('/bulk-ad/assets?tab=copywriting')} className="text-blue-500 hover:underline">+ 新建文案包</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {copywritingPackages.map(pkg => (
                      <label key={pkg._id} className={`flex items-center p-3 border rounded-lg cursor-pointer ${ad.copywritingPackageIds.includes(pkg._id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                        <input type="checkbox" checked={ad.copywritingPackageIds.includes(pkg._id)} onChange={(e) => setAd({...ad, copywritingPackageIds: e.target.checked ? [...ad.copywritingPackageIds, pkg._id] : ad.copywritingPackageIds.filter(id => id !== pkg._id)})} className="mr-2" />
                        <div><div className="font-medium text-sm">{pkg.name}</div><div className="text-xs text-slate-500">{pkg.callToAction}</div></div>
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={() => navigate('/bulk-ad/assets?tab=copywriting')} className="text-sm text-blue-500 mt-2 hover:underline">+ 新建文案包</button></div>
            </div>
          )}
          
          {currentStep === 5 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">发布预览</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">定向分配级别</label>
                  <select value={publishStrategy.targetingLevel} onChange={(e) => setPublishStrategy({...publishStrategy, targetingLevel: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="ADSET">按广告组</option><option value="CAMPAIGN">按广告系列</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">文案包分配方式</label>
                  <select value={publishStrategy.copywritingMode} onChange={(e) => setPublishStrategy({...publishStrategy, copywritingMode: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="SHARED">共用</option><option value="SEQUENTIAL">轮换</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">发布计划</label>
                  <select value={publishStrategy.schedule} onChange={(e) => setPublishStrategy({...publishStrategy, schedule: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="IMMEDIATE">立即发布</option><option value="SCHEDULED">定时发布</option>
                  </select></div>
              </div>
              <div className="bg-slate-50 rounded-lg p-6">
                <h4 className="font-semibold mb-4">广告结构预览</h4>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalAccounts}</div><div className="text-sm text-slate-500">账户</div></div>
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalCampaigns}</div><div className="text-sm text-slate-500">广告系列</div></div>
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalAdsets}</div><div className="text-sm text-slate-500">广告组</div></div>
                  <div><div className="text-3xl font-bold text-blue-600">{estimates.totalAds}</div><div className="text-sm text-slate-500">广告</div></div>
                </div>
                <div className="mt-4 pt-4 border-t text-center"><span className="text-slate-600">预估日预算: </span><span className="text-xl font-bold text-green-600">${estimates.dailyBudget}</span></div>
              </div>
            </div>
          )}
        </div>
        
        {/* Bottom buttons */}
        <div className="flex justify-between mt-6">
          <button 
            onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))} 
            disabled={currentStep === 1} 
            className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            上一步
          </button>
          {currentStep < STEPS.length ? (
            <button 
              onClick={() => setCurrentStep(prev => Math.min(STEPS.length, prev + 1))} 
              disabled={currentStep === 1 && (!authStatus?.authorized || selectedAccounts.length === 0)}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
            </button>
          ) : (
            <button 
              onClick={handlePublish} 
              disabled={loading} 
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? '发布中...' : '发布广告'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
