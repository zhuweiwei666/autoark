import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Loading from '../components/Loading'

const API_BASE = '/api'

const STEPS = [
  { id: 1, title: '选择产品', description: '选择文案包(产品)' },
  { id: 2, title: '选择像素', description: '选择追踪Pixel' },
  { id: 3, title: '选择账户', description: '基于Pixel选账户' },
  { id: 4, title: '广告系列', description: '名称、预算、竞价' },
  { id: 5, title: '广告组', description: '定向、版位、排期' },
  { id: 6, title: '广告创意', description: '素材、创意组' },
  { id: 7, title: '预览发布', description: '确认并发布' },
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
  
  // 资产包
  const [targetingPackages, setTargetingPackages] = useState<any[]>([])
  const [copywritingPackages, setCopywritingPackages] = useState<any[]>([])
  const [creativeGroups, setCreativeGroups] = useState<any[]>([])

  // 选中的产品（文案包）
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  
  // 选中的 Pixel
  const [selectedPixel, setSelectedPixel] = useState<any>(null)
  const [allPixels, setAllPixels] = useState<any[]>([]) // 所有可用的 Pixels
  const [pixelsLoading, setPixelsLoading] = useState(false)
  
  // 基于 Pixel 筛选的账户
  const [filteredAccounts, setFilteredAccounts] = useState<any[]>([])
  
  // 每个账户的主页列表
  const [accountPages, setAccountPages] = useState<{ [accountId: string]: any[] }>({})

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
    status: 'ACTIVE', // 默认开启
    targetingPackageId: '',
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    billingEvent: 'IMPRESSIONS',
    placementType: 'AUTOMATIC',
    budget: 50, // AdSet 级别预算（非 CBO 模式时使用）
  })
  const [ad, setAd] = useState({
    nameTemplate: '{adsetName}_ad_{index}',
    status: 'ACTIVE', // 默认开启
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
  
  // 授权后立即加载缓存的 Pixels（不等到步骤2）
  useEffect(() => {
    if (authStatus?.authorized && allPixels.length === 0 && !pixelsLoading) {
      loadCachedPixels()
    }
  }, [authStatus?.authorized])
  
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
  
  // Facebook 登录（弹窗方式）
  const handleFacebookLogin = async () => {
    setLoginLoading(true)
    setError(null)
    
    try {
      // 获取登录 URL
      const res = await fetch(`${API_BASE}/bulk-ad/auth/login-url`)
      const data = await res.json()
      
      if (!data.success || !data.data.loginUrl) {
        throw new Error(data.error || '获取登录链接失败')
      }
      
      const loginUrl = data.data.loginUrl
      
      // 打开弹窗进行授权
      const width = 600
      const height = 700
      const left = window.screenX + (window.outerWidth - width) / 2
      const top = window.screenY + (window.outerHeight - height) / 2
      
      const popup = window.open(
        loginUrl,
        'facebook-auth',
        `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`
      )
      
      if (!popup) {
        // 弹窗被阻止，回退到页面跳转
        window.location.href = loginUrl
        return
      }
      
      // 监听弹窗关闭和消息
      const checkPopup = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopup)
          setLoginLoading(false)
          // 弹窗关闭后检查授权状态
          checkAuthStatus()
        }
      }, 500)
      
      // 监听来自弹窗的消息
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'oauth-success') {
          clearInterval(checkPopup)
          window.removeEventListener('message', handleMessage)
          popup.close()
          setLoginLoading(false)
          checkAuthStatus()
        } else if (event.data?.type === 'oauth-error') {
          clearInterval(checkPopup)
          window.removeEventListener('message', handleMessage)
          popup.close()
          setLoginLoading(false)
          setError(event.data.error || '授权失败')
        }
      }
      window.addEventListener('message', handleMessage)
      
      // 超时处理（5分钟）
      setTimeout(() => {
        clearInterval(checkPopup)
        window.removeEventListener('message', handleMessage)
        if (!popup.closed) {
          setLoginLoading(false)
        }
      }, 300000)
      
    } catch (err: any) {
      setError(err.message || '登录失败')
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
  
  // 同步状态
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_syncStatus, setSyncStatus] = useState<any>(null)
  
  // 加载缓存的 Pixels（快速，从数据库读取）
  const loadCachedPixels = async () => {
    setPixelsLoading(true)
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/auth/cached-pixels`)
      const data = await res.json()
      if (data.success && data.data?.length > 0) {
        const pixels = data.data
        setAllPixels(pixels)
        
        // 自动选中包含产品名的 Pixel
        autoSelectMatchingPixel(pixels)
        return true
      }
      return false
    } catch (err) {
      console.error('Failed to load cached pixels:', err)
      return false
    } finally {
      setPixelsLoading(false)
    }
  }
  
  // 自动选中包含产品名的 Pixel
  const autoSelectMatchingPixel = (pixels: any[]) => {
    if (!selectedProduct) return
    
    const productName = (selectedProduct.product?.name || selectedProduct.name || '').toLowerCase()
    if (!productName) return
    
    // 查找名称包含产品名的 Pixel
    const matchingPixel = pixels.find(p => 
      p.name?.toLowerCase().includes(productName) ||
      productName.includes(p.name?.toLowerCase())
    )
    
    if (matchingPixel) {
      setSelectedPixel(matchingPixel)
      filterAccountsByPixel(matchingPixel)
    }
  }
  
  // 检查同步状态
  const checkSyncStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/auth/sync-status`)
      const data = await res.json()
      if (data.success) {
        setSyncStatus(data.data)
        return data.data
      }
    } catch (err) {
      console.error('Failed to check sync status:', err)
    }
    return null
  }
  
  // 手动触发重新同步
  const triggerResync = async () => {
    try {
      await fetch(`${API_BASE}/bulk-ad/auth/resync`, { method: 'POST' })
      // 开始轮询状态
      const pollInterval = setInterval(async () => {
        const status = await checkSyncStatus()
        if (status?.status === 'completed') {
          clearInterval(pollInterval)
          loadCachedPixels()
        }
      }, 2000)
      // 30秒后停止轮询
      setTimeout(() => clearInterval(pollInterval), 30000)
    } catch (err) {
      console.error('Failed to trigger resync:', err)
    }
  }
  
  // 传统方式加载 Pixels（作为后备）
  const loadAllPixels = async () => {
    // 先尝试从缓存加载
    const cached = await loadCachedPixels()
    if (cached) return
    
    // 缓存为空，实时抓取
    if (!accounts.length) return
    setPixelsLoading(true)
    try {
      const pixelMap = new Map<string, any>()
      
      for (const account of accounts) {
        const accountId = account.account_id || account.id?.replace('act_', '')
        try {
          const res = await fetch(`${API_BASE}/bulk-ad/auth/pixels?accountId=${accountId}`)
          const data = await res.json()
          if (data.success && data.data) {
            for (const pixel of data.data) {
              if (!pixelMap.has(pixel.id)) {
                pixelMap.set(pixel.id, {
                  ...pixel,
                  accounts: [{ accountId, accountName: account.name }]
                })
              } else {
                const existing = pixelMap.get(pixel.id)
                existing.accounts.push({ accountId, accountName: account.name })
              }
            }
          }
        } catch (err) {
          console.error(`Failed to load pixels for account ${accountId}:`, err)
        }
      }
      
      const pixels = Array.from(pixelMap.values())
      setAllPixels(pixels)
      autoSelectMatchingPixel(pixels)
    } catch (err) {
      console.error('Failed to load all pixels:', err)
    } finally {
      setPixelsLoading(false)
    }
  }
  
  // 根据选中的 Pixel 筛选可用账户
  const filterAccountsByPixel = async (pixel: any) => {
    if (!pixel?.accounts) {
      setFilteredAccounts([])
      return
    }
    
    // 找出拥有该 Pixel 的账户
    const accountIds = pixel.accounts.map((a: any) => a.accountId)
    const filtered = accounts.filter(acc => {
      const accId = acc.account_id || acc.id?.replace('act_', '')
      return accountIds.includes(accId)
    })
    setFilteredAccounts(filtered)
    
    // 自动选择所有活跃状态的账户，传递 pixel 参数
    const activeAccounts = filtered.filter(acc => acc.account_status === 1)
    if (activeAccounts.length > 0) {
      await selectMultipleAccounts(activeAccounts, pixel)
    }
  }
  
  // 批量选择多个账户（pixel 参数用于避免 React 状态异步更新问题）
  const selectMultipleAccounts = async (accountsToSelect: any[], pixelOverride?: any) => {
    const newSelectedAccounts: AccountConfig[] = []
    const newAccountPages: { [key: string]: any[] } = { ...accountPages }
    
    // 使用传入的 pixel 或状态中的 selectedPixel
    const pixel = pixelOverride || selectedPixel
    
    for (const account of accountsToSelect) {
      const accountId = account.account_id || account.id?.replace('act_', '')
      
      // 加载该账户的主页
      let pagesForAccount = newAccountPages[accountId]
      if (!pagesForAccount) {
        try {
          const res = await fetch(`${API_BASE}/bulk-ad/auth/pages?accountId=${accountId}`)
          const data = await res.json()
          if (data.success && data.data) {
            pagesForAccount = data.data
            newAccountPages[accountId] = pagesForAccount
          }
        } catch (err) {
          console.error(`Failed to load pages for account ${accountId}:`, err)
          pagesForAccount = []
        }
      }
      
      newSelectedAccounts.push({
        accountId: accountId,
        accountName: account.name || accountId,
        pageId: '',
        pageName: '',
        pixelId: pixel?.pixelId || pixel?.id || '',
        pixelName: pixel?.name || '',
        conversionEvent: 'PURCHASE',
      })
    }
    
    setAccountPages(newAccountPages)
    const accountsWithPages = autoAssignPages(newSelectedAccounts, newAccountPages)
    setSelectedAccounts(accountsWithPages)
  }
  
  // 全选/取消全选活跃账户
  const toggleSelectAllActive = async () => {
    const activeAccounts = filteredAccounts.filter(acc => acc.account_status === 1)
    const allActiveSelected = activeAccounts.every(acc => {
      const accId = acc.account_id || acc.id?.replace('act_', '')
      return selectedAccounts.find(a => a.accountId === accId)
    })
    
    if (allActiveSelected) {
      // 取消选择所有
      setSelectedAccounts([])
    } else {
      // 全选活跃账户，传递 selectedPixel 确保 pixelId 正确
      await selectMultipleAccounts(activeAccounts, selectedPixel)
    }
  }
  
  // 获取账户状态显示
  const getAccountStatusBadge = (status: number) => {
    switch (status) {
      case 1:
        return <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">✓ 活跃</span>
      case 2:
        return <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">✗ 已停用</span>
      case 3:
        return <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full font-medium">⚠ 未结算</span>
      case 7:
        return <span className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-full font-medium">⏳ 风险审核中</span>
      case 9:
        return <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">⏰ 宽限期</span>
      default:
        return <span className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-full font-medium">未知 ({status})</span>
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
  const toggleAccount = async (account: any) => {
    const accountId = account.account_id || account.id?.replace('act_', '')
    const exists = selectedAccounts.find(a => a.accountId === accountId)
    if (exists) {
      setSelectedAccounts(selectedAccounts.filter(a => a.accountId !== accountId))
    } else {
      // 先加载该账户的主页
      const pagesForAccount = await loadPagesForAccount(accountId)
      
      // 自动设置已选的 Pixel，并自动分配主页
      const newAccount = {
        accountId: accountId,
        accountName: account.name || accountId,
        pageId: '',
        pageName: '',
        pixelId: selectedPixel?.pixelId || selectedPixel?.id || '',
        pixelName: selectedPixel?.name || '',
        conversionEvent: 'PURCHASE',
      }
      
      // 自动分配主页（均摊到各主页）
      const updatedAccounts = [...selectedAccounts, newAccount]
      const accountsWithPages = autoAssignPages(updatedAccounts, { ...accountPages, [accountId]: pagesForAccount })
      setSelectedAccounts(accountsWithPages)
    }
  }
  
  // 加载单个账户的主页
  const loadPagesForAccount = async (accountId: string): Promise<any[]> => {
    // 如果已经加载过，直接返回
    if (accountPages[accountId]) {
      return accountPages[accountId]
    }
    
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/auth/pages?accountId=${accountId}`)
      const data = await res.json()
      if (data.success && data.data) {
        setAccountPages(prev => ({ ...prev, [accountId]: data.data }))
        return data.data
      }
    } catch (err) {
      console.error(`Failed to load pages for account ${accountId}:`, err)
    }
    return []
  }
  
  // 自动分配主页（均摊原则）
  const autoAssignPages = (accounts: AccountConfig[], allPages: { [accountId: string]: any[] }): AccountConfig[] => {
    // 统计每个主页被使用的次数
    const pageUsageCount: { [pageId: string]: number } = {}
    
    return accounts.map(acc => {
      const pagesForThisAccount = allPages[acc.accountId] || []
      
      // 如果该账户没有可用主页，保持空
      if (pagesForThisAccount.length === 0) {
        return acc
      }
      
      // 如果已经分配了主页，跳过
      if (acc.pageId) {
        pageUsageCount[acc.pageId] = (pageUsageCount[acc.pageId] || 0) + 1
        return acc
      }
      
      // 找出使用次数最少的主页
      let minUsage = Infinity
      let selectedPage = pagesForThisAccount[0]
      
      for (const page of pagesForThisAccount) {
        const usage = pageUsageCount[page.id] || 0
        if (usage < minUsage) {
          minUsage = usage
          selectedPage = page
        }
      }
      
      // 更新使用计数
      pageUsageCount[selectedPage.id] = (pageUsageCount[selectedPage.id] || 0) + 1
      
      return {
        ...acc,
        pageId: selectedPage.id,
        pageName: selectedPage.name,
      }
    })
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
          <h1 className="text-2xl font-bold text-slate-900">批量创建广告 <span className="text-xs text-blue-500">v2</span></h1>
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
          {/* 步骤1: 授权 + 选择产品（文案包） */}
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* 授权状态检查 - 放在最前面 */}
              {authLoading ? (
                <Loading.Overlay message="检查授权状态..." size="sm" />
              ) : !authStatus?.authorized ? (
                <div className="text-center py-8 bg-blue-50 border border-blue-200 rounded-xl mb-6">
                  <div className="w-16 h-16 bg-[#1877F2] rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800 mb-2">请先登录 Facebook</h3>
                  <p className="text-slate-500 mb-4 text-sm">登录后才能获取广告账户和 Pixel</p>
                  <button
                    onClick={handleFacebookLogin}
                    disabled={loginLoading}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-[#1877F2] text-white rounded-xl hover:bg-[#166FE5] transition-colors font-medium"
                  >
                    {loginLoading ? (
                      <Loading.Spinner size="sm" color="white" />
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                    )}
                    使用 Facebook 登录
                  </button>
                </div>
              ) : (
                /* 已授权 - 显示状态 + 后台加载 Pixels */
                <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-green-800">已授权: {authStatus.fbUserName}</span>
                      {pixelsLoading && <span className="text-xs text-green-600 ml-2">（正在加载 Pixel...）</span>}
                      {allPixels.length > 0 && <span className="text-xs text-green-600 ml-2">（已加载 {allPixels.length} 个 Pixel）</span>}
                    </div>
                  </div>
                  <button onClick={handleFacebookLogin} className="text-xs text-green-600 hover:underline">切换账号</button>
                </div>
              )}
              
              {/* 只有授权后才显示产品选择 */}
              {authStatus?.authorized && (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800">选择要投放的产品</h3>
                    <p className="text-slate-500 mt-2">选择一个文案包，系统将自动匹配对应的 Pixel 和可投放账户</p>
                  </div>
                  
                  {copywritingPackages.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                  <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-slate-500 mb-4">还没有文案包，请先创建</p>
                  <button 
                    onClick={() => navigate('/bulk-ad/assets?tab=copywriting')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    创建文案包
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {copywritingPackages.map(pkg => (
                    <div
                      key={pkg._id}
                      onClick={() => {
                        setSelectedProduct(pkg)
                        // 自动设置文案包ID到广告配置
                        setAd(prev => ({ ...prev, copywritingPackageIds: [pkg._id] }))
                      }}
                      className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${
                        selectedProduct?._id === pkg._id 
                          ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100' 
                          : 'border-slate-200 hover:border-slate-300 hover:shadow'
                      }`}
                    >
                      {/* 产品标签 */}
                      <div className={`-mx-4 -mt-4 px-4 py-2 rounded-t-lg mb-3 ${
                        selectedProduct?._id === pkg._id 
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-500' 
                          : 'bg-gradient-to-r from-slate-400 to-slate-500'
                      }`}>
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                          </svg>
                          <span className="text-white font-semibold text-sm">
                            {pkg.product?.name || '未设置产品名'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-slate-800">{pkg.name}</div>
                          <div className="text-sm text-slate-500 mt-1">
                            <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-xs">{pkg.callToAction}</span>
                          </div>
                          {pkg.content?.primaryTexts?.[0] && (
                            <div className="text-sm text-slate-600 mt-2 line-clamp-2">{pkg.content.primaryTexts[0]}</div>
                          )}
                        </div>
                        {selectedProduct?._id === pkg._id && (
                          <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 ml-3">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {selectedProduct && (
                <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                      <div className="font-medium text-emerald-800">已选择产品</div>
                      <div className="text-sm text-emerald-600">
                        {selectedProduct.product?.name || selectedProduct.name} 
                        {selectedProduct.links?.websiteUrl && (
                          <span className="ml-2 text-emerald-500">→ {new URL(selectedProduct.links.websiteUrl).hostname}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          )}
          
          {/* 步骤2: 选择 Pixel */}
          {currentStep === 2 && (
            <div className="space-y-6">
              {/* 选中的产品信息 */}
              {selectedProduct && (
                <div className="p-4 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg text-white">
                  <div className="flex items-center gap-3">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                    </svg>
                    <div>
                      <div className="font-semibold">投放产品: {selectedProduct.product?.name || selectedProduct.name}</div>
                      <div className="text-sm text-white/80">选择用于追踪该产品转化的 Pixel</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* 授权检查 */}
              {authLoading ? (
                <Loading.Overlay message="检查授权状态..." size="sm" />
              ) : accountsLoading ? (
                <Loading.Overlay message="加载账户信息..." size="sm" />
              ) : !authStatus?.authorized ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-semibold text-slate-800 mb-2">请先登录 Facebook</h3>
                  <p className="text-slate-500 mb-6">登录后才能获取您的 Pixel 列表</p>
                  <button onClick={handleFacebookLogin} disabled={loginLoading} className="px-6 py-3 bg-[#1877F2] text-white rounded-xl hover:bg-[#166FE5]">
                    {loginLoading ? '登录中...' : '使用 Facebook 登录'}
                    </button>
                </div>
              ) : (
                <>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800">选择追踪 Pixel</h3>
                    <p className="text-slate-500 mt-2">Pixel 决定了哪些账户可以投放此产品</p>
                  </div>
                  
                  {/* 加载 Pixels */}
                  {allPixels.length === 0 && !pixelsLoading && (
                    <div className="text-center py-8 bg-slate-50 rounded-xl">
                      <p className="text-slate-500 mb-4">Pixel 正在后台同步中...</p>
                      <button onClick={loadAllPixels} className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700">
                        立即加载
                      </button>
                      <button onClick={triggerResync} className="ml-3 px-4 py-3 text-purple-600 hover:underline text-sm">
                        重新同步
                      </button>
                    </div>
                  )}
                  
                  {pixelsLoading && (
                    <Loading.Overlay message="加载 Pixel 列表..." size="sm" />
                  )}
                  
                  {allPixels.length > 0 && (
                    <div className="grid grid-cols-2 gap-4">
                      {allPixels.map(pixel => {
                        const productName = (selectedProduct?.product?.name || selectedProduct?.name || '').toLowerCase()
                        const pixelName = (pixel.name || '').toLowerCase()
                        const isMatching = productName && (pixelName.includes(productName) || productName.includes(pixelName))
                        const isSelected = (selectedPixel?.pixelId || selectedPixel?.id) === (pixel.pixelId || pixel.id)
                        
                        return (
                          <div
                            key={pixel.id}
                            onClick={() => {
                              setSelectedPixel(pixel)
                              filterAccountsByPixel(pixel)
                            }}
                            className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${
                              isSelected 
                                ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100' 
                                : isMatching
                                  ? 'border-emerald-300 bg-emerald-50/50 hover:border-emerald-400 ring-2 ring-emerald-200'
                                  : 'border-slate-200 hover:border-slate-300 hover:shadow'
                            }`}
                          >
                            {/* 推荐标签 */}
                            {isMatching && !isSelected && (
                              <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-500 text-white text-xs rounded-full">
                                推荐
                              </div>
                            )}
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <svg className={`w-5 h-5 ${isSelected || isMatching ? 'text-emerald-600' : 'text-purple-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                  </svg>
                                  <div className={`font-semibold ${isSelected || isMatching ? 'text-emerald-800' : 'text-slate-800'}`}>{pixel.name}</div>
                                  {isMatching && (
                                    <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">匹配产品</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-500 mt-1">ID: {pixel.id}</div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {pixel.accounts?.slice(0, 3).map((acc: any, idx: number) => (
                                    <span key={idx} className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                      {acc.accountName || acc.accountId}
                                    </span>
                                  ))}
                                  {(pixel.accounts?.length || 0) > 3 && (
                                    <span className="text-xs text-slate-400">+{pixel.accounts.length - 3}</span>
                                  )}
                                </div>
                                <div className={`text-xs mt-2 ${isSelected || isMatching ? 'text-emerald-600' : 'text-purple-600'}`}>
                                  可用于 {pixel.accounts?.length || 0} 个账户
                                </div>
                              </div>
                              {isSelected && (
                                <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0">
                                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  
                  {selectedPixel && (
                    <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center">
                          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <div>
                          <div className="font-medium text-purple-800">已选择 Pixel: {selectedPixel.name}</div>
                          <div className="text-sm text-purple-600">
                            共 {selectedPixel.accounts?.length || 0} 个账户可使用此 Pixel 投放
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          
          {/* 步骤3: 选择账户（基于 Pixel） */}
          {currentStep === 3 && (
            <div className="space-y-6">
              {/* 已选产品和 Pixel */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="text-xs text-emerald-600 mb-1">投放产品</div>
                  <div className="font-semibold text-emerald-800">{selectedProduct?.product?.name || selectedProduct?.name}</div>
                </div>
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="text-xs text-purple-600 mb-1">追踪 Pixel</div>
                  <div className="font-semibold text-purple-800">{selectedPixel?.name}</div>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold">选择投放账户</h3>
                  <p className="text-slate-500 text-sm">以下账户已绑定所选 Pixel，可以投放该产品</p>
                </div>
                {filteredAccounts.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500">
                      活跃: {filteredAccounts.filter(a => a.account_status === 1).length} / 
                      已选: {selectedAccounts.length}
                    </span>
                    <button
                      onClick={toggleSelectAllActive}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                      {filteredAccounts.filter(a => a.account_status === 1).every(acc => {
                        const accId = acc.account_id || acc.id?.replace('act_', '')
                        return selectedAccounts.find(a => a.accountId === accId)
                      }) ? '取消全选' : '全选活跃账户'}
                    </button>
                  </div>
                )}
              </div>
              
              {filteredAccounts.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                  <svg className="w-12 h-12 text-slate-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-slate-500">没有找到绑定此 Pixel 的账户</p>
                  <button onClick={() => setCurrentStep(2)} className="mt-4 text-purple-600 hover:underline">返回选择其他 Pixel</button>
                    </div>
                  ) : (
                    <>
                  <div className="grid grid-cols-2 gap-4">
                    {filteredAccounts.map(account => {
                      const accountId = account.account_id || account.id?.replace('act_', '')
                      const isActive = account.account_status === 1
                      const isSelected = !!selectedAccounts.find(a => a.accountId === accountId)
                      return (
                        <label 
                          key={accountId} 
                          className={`flex items-center p-4 border-2 rounded-xl transition-all ${
                            !isActive 
                              ? 'border-slate-200 bg-slate-100 cursor-not-allowed opacity-60' 
                              : isSelected 
                                ? 'border-blue-500 bg-blue-50 shadow-lg shadow-blue-100 cursor-pointer' 
                                : 'border-slate-200 hover:border-slate-300 hover:shadow cursor-pointer'
                          }`}
                        >
                          <input 
                            type="checkbox" 
                            checked={isSelected} 
                            onChange={() => isActive && toggleAccount(account)} 
                            disabled={!isActive}
                            className="mr-3 w-5 h-5" 
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-slate-800">{account.name || accountId}</div>
                            <div className="text-sm text-slate-500">{accountId}</div>
                          </div>
                          {getAccountStatusBadge(account.account_status)}
                        </label>
                      )
                    })}
                  </div>
                      
                      {selectedAccounts.length > 0 && (
                        <div className="space-y-4 mt-6">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">配置粉丝页（自动均摊分配）</h4>
                      </div>
                      
                      {/* 警告：有账户没有主页 - 阻止继续 */}
                      {selectedAccounts.some(acc => !acc.pageId) && (
                        <div className="p-4 bg-red-100 border-2 border-red-400 rounded-xl flex items-start gap-3">
                          <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </div>
                          <div>
                            <div className="font-bold text-red-800">⚠️ 无法继续：部分账户没有可用主页</div>
                            <p className="text-sm text-red-700 mt-1">
                              以下账户在 Facebook 没有绑定可推广主页，必须取消选择才能继续：
                            </p>
                            <ul className="mt-2 space-y-1">
                              {selectedAccounts.filter(acc => !acc.pageId).map(acc => (
                                <li key={acc.accountId} className="text-sm text-red-600 flex items-center gap-2">
                                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                                  {acc.accountName} ({acc.accountId})
                                </li>
                              ))}
                            </ul>
                            <p className="text-xs text-red-600 mt-2">
                              请在 Facebook Business Manager 中为这些账户绑定主页，或取消选择这些账户。
                            </p>
                          </div>
                        </div>
                      )}
                      
                      {selectedAccounts.map(acc => {
                        const pagesForAccount = accountPages[acc.accountId] || []
                        const hasNoPages = pagesForAccount.length === 0 && accountPages[acc.accountId] !== undefined
                        
                        return (
                          <div key={acc.accountId} className={`p-4 border rounded-lg ${hasNoPages ? 'bg-red-50 border-red-300' : 'bg-slate-50'}`}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="font-medium text-slate-700">{acc.accountName}</div>
                              {acc.pageId && (
                                <span className="text-xs px-2 py-1 bg-green-100 text-green-600 rounded">已分配主页</span>
                              )}
                              {hasNoPages && (
                                <span className="text-xs px-2 py-1 bg-red-100 text-red-600 rounded flex items-center gap-1">
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  无可用主页
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">Facebook 主页 *</label>
                                {hasNoPages ? (
                                  <div className="px-3 py-2 border border-red-300 rounded-lg bg-red-100 text-red-600 text-sm">
                                    该账户没有可用主页
                                  </div>
                                ) : (
                                  <select 
                                    value={acc.pageId} 
                                    onChange={(e) => {
                                      const page = pagesForAccount.find((p: any) => p.id === e.target.value)
                                      updateAccountConfig(acc.accountId, 'pageId', e.target.value)
                                      if (page) updateAccountConfig(acc.accountId, 'pageName', page.name)
                                    }} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                  >
                                    <option value="">选择主页</option>
                                    {pagesForAccount.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                  </select>
                                )}
                                </div>
                                <div>
                                  <label className="block text-sm text-slate-600 mb-1">转化事件</label>
                                  <select 
                                    value={acc.conversionEvent} 
                                    onChange={(e) => updateAccountConfig(acc.accountId, 'conversionEvent', e.target.value)} 
                                    className="w-full px-3 py-2 border rounded-lg"
                                  disabled={hasNoPages}
                                  >
                                    <option value="PURCHASE">Purchase</option>
                                    <option value="ADD_TO_CART">Add to Cart</option>
                                    <option value="INITIATE_CHECKOUT">Initiate Checkout</option>
                                    <option value="LEAD">Lead</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                        )
                      })}
                        </div>
                  )}
                </>
              )}
            </div>
          )}
          
          {currentStep === 4 && (
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
                <div><label className="block text-sm text-slate-600 mb-1">竞价策略</label>
                  <select value={campaign.bidStrategy} onChange={(e) => setCampaign({...campaign, bidStrategy: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="LOWEST_COST_WITHOUT_CAP">最低成本</option><option value="COST_CAP">费用上限</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={campaign.status} onChange={(e) => setCampaign({...campaign, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="PAUSED">暂停</option><option value="ACTIVE">启用</option>
                  </select></div>
              </div>
              
              {/* CBO 预算设置 */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="font-medium text-slate-800">预算优化 (CBO)</h4>
                    <p className="text-sm text-slate-500">启用后，预算在广告系列级别设置，Facebook 自动分配到各广告组</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCampaign({...campaign, budgetOptimization: !campaign.budgetOptimization})}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${campaign.budgetOptimization ? 'bg-blue-600' : 'bg-slate-200'}`}
                    >
                      <span className={`inline-block h-5 w-5 transform rounded-full bg-white border border-slate-300 transition-transform ${campaign.budgetOptimization ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-sm font-medium text-slate-700">{campaign.budgetOptimization ? '已启用' : '未启用'}</span>
                  </div>
                </div>
                
                {campaign.budgetOptimization && (
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-blue-200">
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">预算类型</label>
                      <select value={campaign.budgetType} onChange={(e) => setCampaign({...campaign, budgetType: e.target.value})} className="w-full px-3 py-2 border rounded-lg bg-white">
                        <option value="DAILY">日预算</option><option value="LIFETIME">总预算</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">广告系列预算 ($)</label>
                      <input type="number" value={campaign.budget} onChange={(e) => setCampaign({...campaign, budget: Number(e.target.value)})} min="1" className="w-full px-3 py-2 border rounded-lg bg-white" />
                      <p className="text-xs text-blue-600 mt-1">此预算将由 Facebook 自动分配到各广告组</p>
                    </div>
                  </div>
                )}
                
                {!campaign.budgetOptimization && (
                  <div className="pt-4 border-t border-blue-200">
                    <p className="text-sm text-amber-600 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                      未启用 CBO，请在下一步（广告组设置）中为每个广告组设置预算
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {currentStep === 5 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告组设置</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">广告组名称模板</label>
                  <input type="text" value={adset.nameTemplate} onChange={(e) => setAdset({...adset, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={adset.status} onChange={(e) => setAdset({...adset, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="ACTIVE">启用</option><option value="PAUSED">暂停</option>
                  </select></div>
                <div><label className="block text-sm text-slate-600 mb-1">定向包</label>
                  <select value={adset.targetingPackageId} onChange={(e) => {
                    const pkgId = e.target.value
                    const pkg = targetingPackages.find((p: any) => p._id === pkgId)
                    setAdset({
                      ...adset, 
                      targetingPackageId: pkgId,
                      // 从定向包同步版位和优化目标设置
                      optimizationGoal: pkg?.optimizationGoal || adset.optimizationGoal,
                      placementType: pkg?.placement?.type === 'manual' ? 'MANUAL' : 'AUTOMATIC',
                    })
                  }} className="w-full px-3 py-2 border rounded-lg">
                    <option value="">选择定向包</option>{targetingPackages.map((pkg: any) => <option key={pkg._id} value={pkg._id}>{pkg.name}</option>)}
                  </select>
                  <button onClick={() => navigate('/bulk-ad/assets?tab=targeting')} className="text-xs text-blue-500 mt-1 hover:underline">+ 新建定向包</button></div>
              </div>
              
              {/* 从定向包读取的配置（只读显示） */}
              {adset.targetingPackageId && (() => {
                const pkg = targetingPackages.find((p: any) => p._id === adset.targetingPackageId) as any
                return pkg ? (
                  <div className="mt-4 p-4 bg-slate-50 rounded-lg">
                    <div className="text-sm text-slate-500 mb-2">以下设置来自定向包「{pkg.name}」</div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">版位：</span>
                        <span className="ml-1 font-medium">{pkg.placement?.type === 'manual' ? '手动版位' : '自动版位'}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">优化目标：</span>
                        <span className="ml-1 font-medium">
                          {pkg.optimizationGoal === 'OFFSITE_CONVERSIONS' ? '网站转化' : 
                           pkg.optimizationGoal === 'LINK_CLICKS' ? '链接点击' : 
                           pkg.optimizationGoal === 'LANDING_PAGE_VIEWS' ? '落地页浏览' : '网站转化'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">受众：</span>
                        <span className="ml-1 font-medium">
                          {pkg.geoLocations?.countries?.join(', ') || '全球'} / {pkg.demographics?.ageMin || 18}-{pkg.demographics?.ageMax || 65}岁
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null
              })()}
              
              {/* 广告组预算（非 CBO 模式） */}
              {!campaign.budgetOptimization && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <h4 className="font-medium text-slate-800 mb-3">广告组预算</h4>
                  <p className="text-sm text-slate-500 mb-4">由于未启用 CBO，每个广告组需要单独设置预算</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">预算类型</label>
                      <select value={campaign.budgetType} onChange={(e) => setCampaign({...campaign, budgetType: e.target.value})} className="w-full px-3 py-2 border rounded-lg bg-white">
                        <option value="DAILY">日预算</option><option value="LIFETIME">总预算</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-slate-600 mb-1">广告组预算 ($)</label>
                      <input type="number" value={adset.budget} onChange={(e) => setAdset({...adset, budget: Number(e.target.value)})} min="1" className="w-full px-3 py-2 border rounded-lg bg-white" />
                      <p className="text-xs text-amber-600 mt-1">每个广告组将使用此预算</p>
                    </div>
                  </div>
                </div>
              )}
              
              {campaign.budgetOptimization && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    <span className="font-medium">已启用 CBO 预算优化</span>
                  </div>
                  <p className="text-sm text-green-600 mt-1">广告系列预算 ${campaign.budget}，Facebook 将自动分配到各广告组</p>
                </div>
              )}
            </div>
          )}
          
          {currentStep === 6 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">广告创意设置</h3>
              <div className="grid grid-cols-3 gap-6">
                <div><label className="block text-sm text-slate-600 mb-1">广告名称模板</label>
                  <input type="text" value={ad.nameTemplate} onChange={(e) => setAd({...ad, nameTemplate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
                <div><label className="block text-sm text-slate-600 mb-1">初始状态</label>
                  <select value={ad.status} onChange={(e) => setAd({...ad, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="ACTIVE">启用</option><option value="PAUSED">暂停</option>
                  </select></div>
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
                        <div><div className="font-medium text-sm">{group.name}</div><div className="text-xs text-slate-500">{group.materials?.length || 0} 个素材</div></div>
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
          
          {currentStep === 7 && (
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
              disabled={
                (currentStep === 1 && (!authStatus?.authorized || !selectedProduct)) || // 步骤1: 必须授权并选择产品
                (currentStep === 2 && !selectedPixel) || // 步骤2: 必须选择 Pixel
                (currentStep === 3 && (selectedAccounts.length === 0 || selectedAccounts.some(acc => !acc.pageId))) // 步骤3: 必须选择账户且所有账户都有主页
              }
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一步
            </button>
          ) : (
            <button 
              onClick={handlePublish} 
              disabled={loading || selectedAccounts.some(acc => !acc.pageId)} 
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
