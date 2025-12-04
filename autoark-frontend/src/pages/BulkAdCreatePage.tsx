import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'

const API_BASE = '/api'

const STEPS = [
  { id: 1, title: '基本配置', description: '选择账户、主页、像素' },
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

export default function BulkAdCreatePage() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [hasToken, setHasToken] = useState<boolean | null>(null) // null = loading
  const [accounts, setAccounts] = useState<any[]>([])
  const [pages, setPages] = useState<any[]>([])
  const [pixels, setPixels] = useState<any[]>([])
  const [targetingPackages, setTargetingPackages] = useState<any[]>([])
  const [copywritingPackages, setCopywritingPackages] = useState<any[]>([])
  const [creativeGroups, setCreativeGroups] = useState<any[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  
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
  
  useEffect(() => {
    checkTokenAndLoadAccounts()
    loadAssets()
  }, [])
  
  const checkTokenAndLoadAccounts = async () => {
    setAccountsLoading(true)
    try {
      // 1. 检查是否有有效的 Facebook Token
      const tokenRes = await fetch(`${API_BASE}/fb-token`)
      const tokenData = await tokenRes.json()
      const tokens = tokenData.data || []
      const activeToken = tokens.find((t: any) => t.status === 'active')
      setHasToken(!!activeToken)
      
      if (!activeToken) {
        setAccountsLoading(false)
        return
      }
      
      // 2. 加载账户列表
      const res = await fetch(`${API_BASE}/facebook/accounts`)
      const data = await res.json()
      if (data.success) setAccounts(data.data || [])
    } catch (err) {
      console.error('Failed to load accounts:', err)
      setHasToken(false)
    } finally {
      setAccountsLoading(false)
    }
  }
  
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
  
  const loadAccountAssets = async (accountId: string) => {
    try {
      const [pagesRes, pixelsRes] = await Promise.all([
        fetch(`${API_BASE}/bulk-ad/facebook/pages?accountId=${accountId}`),
        fetch(`${API_BASE}/bulk-ad/facebook/pixels?accountId=${accountId}`),
      ])
      const pagesData = await pagesRes.json()
      const pixelsData = await pixelsRes.json()
      if (pagesData.success) setPages(pagesData.data || [])
      if (pixelsData.success) setPixels(pixelsData.data || [])
    } catch (err) {
      console.error('Failed to load account assets:', err)
    }
  }
  
  const toggleAccount = (account: any) => {
    const exists = selectedAccounts.find(a => a.accountId === account.account_id)
    if (exists) {
      setSelectedAccounts(selectedAccounts.filter(a => a.accountId !== account.account_id))
    } else {
      setSelectedAccounts([...selectedAccounts, {
        accountId: account.account_id,
        accountName: account.name || account.account_id,
        pageId: '', pageName: '', pixelId: '', pixelName: '', conversionEvent: 'PURCHASE',
      }])
    }
  }
  
  const updateAccountConfig = (accountId: string, field: string, value: string) => {
    setSelectedAccounts(selectedAccounts.map(a => 
      a.accountId === accountId ? { ...a, [field]: value } : a
    ))
  }
  
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
              <h3 className="text-lg font-semibold">选择投放账户</h3>
              
              {/* 加载中 */}
              {accountsLoading && (
                <div className="text-center py-12 text-slate-500">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                  <p>正在检查 Facebook 授权状态...</p>
                </div>
              )}
              
              {/* 未绑定 Facebook */}
              {!accountsLoading && hasToken === false && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-6 text-center">
                  <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-8 h-8 text-orange-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-orange-800 mb-2">请先绑定 Facebook 账号</h4>
                  <p className="text-orange-600 mb-4">在创建广告之前，您需要先授权 Facebook 账号并同步广告资产</p>
                  <Link to="/fb-token" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                    </svg>
                    前往 Token 管理绑定 Facebook
                  </Link>
                </div>
              )}
              
              {/* 已绑定但没有账户 */}
              {!accountsLoading && hasToken === true && accounts.length === 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 text-center">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-8 h-8 text-blue-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-blue-800 mb-2">请同步 Facebook 广告账户</h4>
                  <p className="text-blue-600 mb-4">您已绑定 Facebook，但还没有同步广告账户资产</p>
                  <Link to="/fb-accounts" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    前往账户管理同步资产
                  </Link>
                </div>
              )}
              
              {/* 有账户可选 */}
              {!accountsLoading && hasToken === true && accounts.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    {accounts.map(account => (
                      <label key={account.account_id} className={`flex items-center p-4 border rounded-lg cursor-pointer transition-colors ${
                        selectedAccounts.find(a => a.accountId === account.account_id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                      }`}>
                        <input type="checkbox" checked={!!selectedAccounts.find(a => a.accountId === account.account_id)} onChange={() => toggleAccount(account)} className="mr-3" />
                        <div><div className="font-medium">{account.name || account.account_id}</div><div className="text-sm text-slate-500">{account.account_id}</div></div>
                      </label>
                    ))}
                  </div>
                  {selectedAccounts.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="font-semibold">账户配置</h4>
                      {selectedAccounts.map(acc => (
                        <div key={acc.accountId} className="p-4 border rounded-lg grid grid-cols-3 gap-4">
                          <div><label className="block text-sm text-slate-600 mb-1">Facebook 主页</label>
                            <select value={acc.pageId} onChange={(e) => updateAccountConfig(acc.accountId, 'pageId', e.target.value)} onFocus={() => loadAccountAssets(acc.accountId)} className="w-full px-3 py-2 border rounded-lg">
                              <option value="">选择主页</option>{pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select></div>
                          <div><label className="block text-sm text-slate-600 mb-1">Pixel</label>
                            <select value={acc.pixelId} onChange={(e) => updateAccountConfig(acc.accountId, 'pixelId', e.target.value)} onFocus={() => loadAccountAssets(acc.accountId)} className="w-full px-3 py-2 border rounded-lg">
                              <option value="">选择 Pixel</option>{pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select></div>
                          <div><label className="block text-sm text-slate-600 mb-1">转化事件</label>
                            <select value={acc.conversionEvent} onChange={(e) => updateAccountConfig(acc.accountId, 'conversionEvent', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                              <option value="PURCHASE">Purchase</option><option value="ADD_TO_CART">Add to Cart</option><option value="LEAD">Lead</option>
                            </select></div>
                        </div>
                      ))}
                    </div>
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
                  <input type="text" value={campaign.nameTemplate} onChange={(e) => setCampaign({...campaign, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
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
                  <button onClick={() => navigate('/bulk-ad/targeting')} className="text-xs text-blue-500 mt-1 hover:underline">+ 新建定向包</button></div>
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
                <div className="grid grid-cols-3 gap-3">
                  {creativeGroups.map(group => (
                    <label key={group._id} className={`flex items-center p-3 border rounded-lg cursor-pointer ${ad.creativeGroupIds.includes(group._id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                      <input type="checkbox" checked={ad.creativeGroupIds.includes(group._id)} onChange={(e) => setAd({...ad, creativeGroupIds: e.target.checked ? [...ad.creativeGroupIds, group._id] : ad.creativeGroupIds.filter(id => id !== group._id)})} className="mr-2" />
                      <div><div className="font-medium text-sm">{group.name}</div><div className="text-xs text-slate-500">{group.materialStats?.totalCount || 0} 个素材</div></div>
                    </label>
                  ))}
                </div>
                <button onClick={() => navigate('/bulk-ad/creative')} className="text-sm text-blue-500 mt-2 hover:underline">+ 新建创意组</button></div>
              <div><label className="block text-sm text-slate-600 mb-2">选择文案包</label>
                <div className="grid grid-cols-3 gap-3">
                  {copywritingPackages.map(pkg => (
                    <label key={pkg._id} className={`flex items-center p-3 border rounded-lg cursor-pointer ${ad.copywritingPackageIds.includes(pkg._id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                      <input type="checkbox" checked={ad.copywritingPackageIds.includes(pkg._id)} onChange={(e) => setAd({...ad, copywritingPackageIds: e.target.checked ? [...ad.copywritingPackageIds, pkg._id] : ad.copywritingPackageIds.filter(id => id !== pkg._id)})} className="mr-2" />
                      <div><div className="font-medium text-sm">{pkg.name}</div><div className="text-xs text-slate-500">{pkg.callToAction}</div></div>
                    </label>
                  ))}
                </div>
                <button onClick={() => navigate('/bulk-ad/copywriting')} className="text-sm text-blue-500 mt-2 hover:underline">+ 新建文案包</button></div>
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
              {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg">{error}</div>}
            </div>
          )}
        </div>
        
        {/* Bottom buttons */}
        <div className="flex justify-between mt-6">
          <button onClick={() => setCurrentStep(prev => Math.max(1, prev - 1))} disabled={currentStep === 1} className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 disabled:opacity-50">上一步</button>
          {currentStep < STEPS.length ? (
            <button onClick={() => setCurrentStep(prev => Math.min(STEPS.length, prev + 1))} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">下一步</button>
          ) : (
            <button onClick={handlePublish} disabled={loading} className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">{loading ? '发布中...' : '发布广告'}</button>
          )}
        </div>
      </div>
    </div>
  )
}

