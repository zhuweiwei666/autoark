import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

const API_BASE = '/api'

// 全球国家列表（按洲分组）
const COUNTRIES = {
  '北美洲': [
    { code: 'US', name: '美国' },
    { code: 'CA', name: '加拿大' },
    { code: 'MX', name: '墨西哥' },
  ],
  '南美洲': [
    { code: 'BR', name: '巴西' },
    { code: 'AR', name: '阿根廷' },
    { code: 'CL', name: '智利' },
    { code: 'CO', name: '哥伦比亚' },
    { code: 'PE', name: '秘鲁' },
  ],
  '欧洲': [
    { code: 'GB', name: '英国' },
    { code: 'DE', name: '德国' },
    { code: 'FR', name: '法国' },
    { code: 'IT', name: '意大利' },
    { code: 'ES', name: '西班牙' },
    { code: 'NL', name: '荷兰' },
    { code: 'BE', name: '比利时' },
    { code: 'AT', name: '奥地利' },
    { code: 'CH', name: '瑞士' },
    { code: 'SE', name: '瑞典' },
    { code: 'NO', name: '挪威' },
    { code: 'DK', name: '丹麦' },
    { code: 'FI', name: '芬兰' },
    { code: 'PL', name: '波兰' },
    { code: 'PT', name: '葡萄牙' },
    { code: 'IE', name: '爱尔兰' },
    { code: 'GR', name: '希腊' },
    { code: 'CZ', name: '捷克' },
    { code: 'RO', name: '罗马尼亚' },
    { code: 'HU', name: '匈牙利' },
  ],
  '亚洲': [
    { code: 'CN', name: '中国' },
    { code: 'JP', name: '日本' },
    { code: 'KR', name: '韩国' },
    { code: 'IN', name: '印度' },
    { code: 'ID', name: '印度尼西亚' },
    { code: 'TH', name: '泰国' },
    { code: 'VN', name: '越南' },
    { code: 'MY', name: '马来西亚' },
    { code: 'SG', name: '新加坡' },
    { code: 'PH', name: '菲律宾' },
    { code: 'TW', name: '中国台湾' },
    { code: 'HK', name: '中国香港' },
    { code: 'AE', name: '阿联酋' },
    { code: 'SA', name: '沙特阿拉伯' },
    { code: 'IL', name: '以色列' },
    { code: 'TR', name: '土耳其' },
    { code: 'PK', name: '巴基斯坦' },
    { code: 'BD', name: '孟加拉国' },
  ],
  '大洋洲': [
    { code: 'AU', name: '澳大利亚' },
    { code: 'NZ', name: '新西兰' },
  ],
  '非洲': [
    { code: 'ZA', name: '南非' },
    { code: 'EG', name: '埃及' },
    { code: 'NG', name: '尼日利亚' },
    { code: 'KE', name: '肯尼亚' },
    { code: 'MA', name: '摩洛哥' },
  ],
}

// 视频缩略图组件
function VideoThumbnail({ src, className }: { src: string; className?: string }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  
  useEffect(() => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'
    
    video.onloadeddata = () => { video.currentTime = 0.1 }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0)
          setThumbnail(canvas.toDataURL('image/jpeg', 0.8))
        }
      } catch {}
    }
    video.src = src
    return () => { video.src = '' }
  }, [src])
  
  if (!thumbnail) {
    return (
      <div className={`flex items-center justify-center bg-slate-800 ${className}`}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6 text-white">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      </div>
    )
  }
  
  return (
    <div className={`relative ${className}`}>
      <img src={thumbnail} alt="" className="w-full h-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-6 h-6 bg-black/50 rounded-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="white" className="w-3 h-3 ml-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        </div>
      </div>
    </div>
  )
}

type AssetType = 'targeting' | 'copywriting' | 'creative'

const TAB_CONFIG = {
  targeting: { label: '定向包', endpoint: 'targeting-packages' },
  copywriting: { label: '文案包', endpoint: 'copywriting-packages' },
  creative: { label: '创意组', endpoint: 'creative-groups' },
}

interface Material {
  _id: string
  name: string
  type: 'image' | 'video'
  storage: { url: string }
  folder: string
}

interface Folder {
  _id: string
  name: string
  path: string
  count: number
}

export default function AssetManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<AssetType>((searchParams.get('tab') as AssetType) || 'targeting')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<any>({})
  const [saving, setSaving] = useState(false)
  
  // 素材选择器
  const [showMaterialPicker, setShowMaterialPicker] = useState(false)
  const [materials, setMaterials] = useState<Material[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedMaterials, setSelectedMaterials] = useState<Material[]>([])
  const [materialFilter, setMaterialFilter] = useState({ folder: '', type: '' })
  const [loadingMaterials, setLoadingMaterials] = useState(false)
  
  useEffect(() => {
    loadItems()
  }, [activeTab])
  
  const loadItems = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/${TAB_CONFIG[activeTab].endpoint}`)
      const data = await res.json()
      if (data.success) setItems(data.data?.list || [])
    } catch (err) {
      console.error('Failed to load items:', err)
    } finally {
      setLoading(false)
    }
  }
  
  const loadMaterials = async () => {
    setLoadingMaterials(true)
    try {
      const params = new URLSearchParams({ pageSize: '100' })
      if (materialFilter.folder) params.append('folder', materialFilter.folder)
      if (materialFilter.type) params.append('type', materialFilter.type)
      
      const [matRes, folderRes] = await Promise.all([
        fetch(`${API_BASE}/materials?${params}`),
        fetch(`${API_BASE}/materials/folder-tree`)
      ])
      
      const matData = await matRes.json()
      const folderData = await folderRes.json()
      
      if (matData.success) setMaterials(matData.data.list || [])
      if (folderData.success) setFolders(folderData.data.folders || [])
    } catch (err) {
      console.error('Failed to load materials:', err)
    } finally {
      setLoadingMaterials(false)
    }
  }
  
  const handleTabChange = (tab: AssetType) => {
    setActiveTab(tab)
    setSearchParams({ tab })
    setShowForm(false)
    setFormData({})
  }
  
  const handleSave = async () => {
    setSaving(true)
    try {
      const method = formData._id ? 'PUT' : 'POST'
      const url = formData._id 
        ? `${API_BASE}/bulk-ad/${TAB_CONFIG[activeTab].endpoint}/${formData._id}`
        : `${API_BASE}/bulk-ad/${TAB_CONFIG[activeTab].endpoint}`
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })
      const data = await res.json()
      if (data.success) {
        setShowForm(false)
        setFormData({})
        loadItems()
      } else {
        alert(data.error || '保存失败')
      }
    } catch (err: any) {
      alert(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }
  
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除吗？')) return
    try {
      const res = await fetch(`${API_BASE}/bulk-ad/${TAB_CONFIG[activeTab].endpoint}/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) loadItems()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }
  
  const handleEdit = (item: any) => {
    setFormData(item)
    setShowForm(true)
  }
  
  const openMaterialPicker = () => {
    // 初始化已选中的素材
    const currentMaterials = formData.materials || []
    setSelectedMaterials(currentMaterials.map((m: any) => ({
      _id: m._id || m.url,
      name: m.name || m.url,
      type: m.type,
      storage: { url: m.url },
      folder: ''
    })))
    loadMaterials()
    setShowMaterialPicker(true)
  }
  
  const toggleMaterialSelect = (material: Material) => {
    setSelectedMaterials(prev => {
      const exists = prev.some(m => m._id === material._id)
      if (exists) {
        return prev.filter(m => m._id !== material._id)
      } else {
        return [...prev, material]
      }
    })
  }
  
  const confirmMaterialSelection = () => {
    const materials = selectedMaterials.map(m => ({
      _id: m._id,
      type: m.type,
      url: m.storage.url,
      name: m.name,
      status: 'ready'
    }))
    setFormData({ ...formData, materials })
    setShowMaterialPicker(false)
  }
  
  const removeMaterial = (index: number) => {
    const materials = [...(formData.materials || [])]
    materials.splice(index, 1)
    setFormData({ ...formData, materials })
  }
  
  const renderForm = () => {
    switch (activeTab) {
      case 'targeting':
        return (
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-600 mb-1">名称 *</label>
              <input type="text" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            
            {/* 受众定向 */}
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-medium text-slate-700 mb-3">受众定向</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-slate-600 mb-1">国家/地区</label>
                  <div className="border rounded-lg">
                    {/* 已选国家显示 */}
                    <div className="flex flex-wrap gap-1 p-2 min-h-[40px] border-b bg-slate-50">
                      {(formData.geoLocations?.countries || []).length === 0 ? (
                        <span className="text-sm text-slate-400">点击下方选择国家...</span>
                      ) : (
                        (formData.geoLocations?.countries || []).map((code: string) => {
                          const country = Object.values(COUNTRIES).flat().find(c => c.code === code)
                          return (
                            <span key={code} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm">
                              {country?.name || code}
                              <button type="button" onClick={() => setFormData({...formData, geoLocations: {...formData.geoLocations, countries: (formData.geoLocations?.countries || []).filter((c: string) => c !== code)}})} className="hover:text-blue-900">×</button>
                            </span>
                          )
                        })
                      )}
                    </div>
                    {/* 国家列表 */}
                    <div className="max-h-48 overflow-y-auto p-2 space-y-2">
                      {Object.entries(COUNTRIES).map(([continent, countries]) => (
                        <div key={continent}>
                          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
                            <span>{continent}</span>
                            <button type="button" onClick={() => {
                              const codes = countries.map(c => c.code)
                              const current = formData.geoLocations?.countries || []
                              const allSelected = codes.every(c => current.includes(c))
                              if (allSelected) {
                                setFormData({...formData, geoLocations: {...formData.geoLocations, countries: current.filter((c: string) => !codes.includes(c))}})
                              } else {
                                setFormData({...formData, geoLocations: {...formData.geoLocations, countries: [...new Set([...current, ...codes])]}})
                              }
                            }} className="text-blue-600 hover:underline">
                              {countries.every(c => (formData.geoLocations?.countries || []).includes(c.code)) ? '取消全选' : '全选'}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {countries.map(c => (
                              <label key={c.code} className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-sm border transition-colors ${(formData.geoLocations?.countries || []).includes(c.code) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-50 border-slate-200'}`}>
                                <input type="checkbox" checked={(formData.geoLocations?.countries || []).includes(c.code)} onChange={(e) => {
                                  const countries = formData.geoLocations?.countries || []
                                  if (e.target.checked) {
                                    setFormData({...formData, geoLocations: {...formData.geoLocations, countries: [...countries, c.code]}})
                                  } else {
                                    setFormData({...formData, geoLocations: {...formData.geoLocations, countries: countries.filter((x: string) => x !== c.code)}})
                                  }
                                }} className="hidden" />
                                {c.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm text-slate-600 mb-1">最小年龄</label>
                    <input type="number" value={formData.demographics?.ageMin || 18} onChange={(e) => setFormData({...formData, demographics: {...formData.demographics, ageMin: Number(e.target.value)}})} min="13" max="65" className="w-full px-3 py-2 border rounded-lg" /></div>
                  <div><label className="block text-sm text-slate-600 mb-1">最大年龄</label>
                    <input type="number" value={formData.demographics?.ageMax || 65} onChange={(e) => setFormData({...formData, demographics: {...formData.demographics, ageMax: Number(e.target.value)}})} min="13" max="65" className="w-full px-3 py-2 border rounded-lg" /></div>
                </div>
                <div><label className="block text-sm text-slate-600 mb-1">性别</label>
                  <select value={formData.demographics?.genders?.[0] || ''} onChange={(e) => setFormData({...formData, demographics: {...formData.demographics, genders: e.target.value ? [Number(e.target.value)] : []}})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="">全部</option><option value="1">男性</option><option value="2">女性</option>
                  </select></div>
              </div>
            </div>
            
            {/* 版位设置 */}
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-medium text-slate-700 mb-3">版位设置</h4>
              <div className="space-y-3">
                <div><label className="block text-sm text-slate-600 mb-1">版位类型</label>
                  <select value={formData.placement?.type || 'automatic'} onChange={(e) => setFormData({...formData, placement: {...formData.placement, type: e.target.value}})} className="w-full px-3 py-2 border rounded-lg">
                    <option value="automatic">自动版位（推荐）</option>
                    <option value="manual">手动版位</option>
                  </select></div>
                
                {formData.placement?.type === 'manual' && (
                  <>
                    <div><label className="block text-sm text-slate-600 mb-1">投放平台</label>
                      <div className="grid grid-cols-2 gap-2">
                        {['facebook', 'instagram', 'messenger', 'audience_network'].map(p => (
                          <label key={p} className="flex items-center gap-2 p-2 border rounded hover:bg-slate-50 cursor-pointer">
                            <input type="checkbox" checked={formData.placement?.platforms?.includes(p) || false}
                              onChange={(e) => {
                                const platforms = formData.placement?.platforms || []
                                if (e.target.checked) {
                                  setFormData({...formData, placement: {...formData.placement, platforms: [...platforms, p]}})
                                } else {
                                  setFormData({...formData, placement: {...formData.placement, platforms: platforms.filter((x: string) => x !== p)}})
                                }
                              }}
                              className="rounded" />
                            <span className="text-sm capitalize">{p.replace('_', ' ')}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div><label className="block text-sm text-slate-600 mb-1">设备类型</label>
                      <div className="flex gap-4">
                        {['mobile', 'desktop'].map(d => (
                          <label key={d} className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={formData.placement?.devicePlatforms?.includes(d) || false}
                              onChange={(e) => {
                                const devices = formData.placement?.devicePlatforms || []
                                if (e.target.checked) {
                                  setFormData({...formData, placement: {...formData.placement, devicePlatforms: [...devices, d]}})
                                } else {
                                  setFormData({...formData, placement: {...formData.placement, devicePlatforms: devices.filter((x: string) => x !== d)}})
                                }
                              }}
                              className="rounded" />
                            <span className="text-sm">{d === 'mobile' ? '移动端' : '桌面端'}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                
                {/* 设备和操作系统详细设置 */}
                {(formData.placement?.type === 'manual' && formData.placement?.devicePlatforms?.includes('mobile')) && (
                  <div className="border-t pt-3 mt-3">
                    <h5 className="text-sm font-medium text-slate-600 mb-2">移动设备详细设置</h5>
                    
                    <div className="space-y-3">
                      {/* 操作系统 */}
                      <div><label className="block text-sm text-slate-500 mb-1">操作系统</label>
                        <div className="flex gap-3">
                          {[{v: 'all', l: '全部'}, {v: 'iOS', l: 'iOS'}, {v: 'Android', l: 'Android'}].map(os => (
                            <label key={os.v} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="mobileOS" 
                                checked={(formData.deviceSettings?.mobileOS?.[0] || 'all') === os.v}
                                onChange={() => setFormData({...formData, deviceSettings: {...formData.deviceSettings, mobileOS: [os.v]}})}
                                className="text-blue-600" />
                              <span className="text-sm">{os.l}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      
                      {/* iOS 设备 */}
                      {(formData.deviceSettings?.mobileOS?.[0] === 'iOS' || formData.deviceSettings?.mobileOS?.[0] === 'all' || !formData.deviceSettings?.mobileOS) && (
                        <div><label className="block text-sm text-slate-500 mb-1">iOS 设备</label>
                          <div className="flex flex-wrap gap-2">
                            {[{v: 'iphone_all', l: 'iPhones'}, {v: 'ipad_all', l: 'iPads'}, {v: 'ipod_all', l: 'iPods'}].map(d => (
                              <label key={d.v} className="flex items-center gap-1.5 px-2 py-1 border rounded cursor-pointer hover:bg-slate-50">
                                <input type="checkbox" 
                                  checked={formData.deviceSettings?.mobileDevices?.includes(d.v) || false}
                                  onChange={(e) => {
                                    const devices = formData.deviceSettings?.mobileDevices || []
                                    if (e.target.checked) {
                                      setFormData({...formData, deviceSettings: {...formData.deviceSettings, mobileDevices: [...devices, d.v]}})
                                    } else {
                                      setFormData({...formData, deviceSettings: {...formData.deviceSettings, mobileDevices: devices.filter((x: string) => x !== d.v)}})
                                    }
                                  }}
                                  className="rounded text-blue-600" />
                                <span className="text-sm">{d.l}</span>
                              </label>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="block text-xs text-slate-400">最低 iOS 版本</label>
                              <select value={formData.deviceSettings?.iosVersionMin || ''} 
                                onChange={(e) => setFormData({...formData, deviceSettings: {...formData.deviceSettings, iosVersionMin: e.target.value}})}
                                className="w-full px-2 py-1 border rounded text-sm">
                                <option value="">无限制</option>
                                {['14.0', '15.0', '16.0', '17.0', '18.0'].map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400">最高 iOS 版本</label>
                              <select value={formData.deviceSettings?.iosVersionMax || ''} 
                                onChange={(e) => setFormData({...formData, deviceSettings: {...formData.deviceSettings, iosVersionMax: e.target.value}})}
                                className="w-full px-2 py-1 border rounded text-sm">
                                <option value="">无限制</option>
                                {['14.0', '15.0', '16.0', '17.0', '18.0'].map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Android 设备 */}
                      {(formData.deviceSettings?.mobileOS?.[0] === 'Android' || formData.deviceSettings?.mobileOS?.[0] === 'all' || !formData.deviceSettings?.mobileOS) && (
                        <div><label className="block text-sm text-slate-500 mb-1">Android 设备</label>
                          <div className="flex flex-wrap gap-2">
                            {[{v: 'android_smartphone', l: 'Android 手机'}, {v: 'android_tablet', l: 'Android 平板'}].map(d => (
                              <label key={d.v} className="flex items-center gap-1.5 px-2 py-1 border rounded cursor-pointer hover:bg-slate-50">
                                <input type="checkbox" 
                                  checked={formData.deviceSettings?.mobileDevices?.includes(d.v) || false}
                                  onChange={(e) => {
                                    const devices = formData.deviceSettings?.mobileDevices || []
                                    if (e.target.checked) {
                                      setFormData({...formData, deviceSettings: {...formData.deviceSettings, mobileDevices: [...devices, d.v]}})
                                    } else {
                                      setFormData({...formData, deviceSettings: {...formData.deviceSettings, mobileDevices: devices.filter((x: string) => x !== d.v)}})
                                    }
                                  }}
                                  className="rounded text-blue-600" />
                                <span className="text-sm">{d.l}</span>
                              </label>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                              <label className="block text-xs text-slate-400">最低 Android 版本</label>
                              <select value={formData.deviceSettings?.androidVersionMin || ''} 
                                onChange={(e) => setFormData({...formData, deviceSettings: {...formData.deviceSettings, androidVersionMin: e.target.value}})}
                                className="w-full px-2 py-1 border rounded text-sm">
                                <option value="">无限制</option>
                                {['8.0', '9.0', '10.0', '11.0', '12.0', '13.0', '14.0'].map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-400">最高 Android 版本</label>
                              <select value={formData.deviceSettings?.androidVersionMax || ''} 
                                onChange={(e) => setFormData({...formData, deviceSettings: {...formData.deviceSettings, androidVersionMax: e.target.value}})}
                                className="w-full px-2 py-1 border rounded text-sm">
                                <option value="">无限制</option>
                                {['8.0', '9.0', '10.0', '11.0', '12.0', '13.0', '14.0'].map(v => <option key={v} value={v}>{v}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Wi-Fi 限制 */}
                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" 
                            checked={formData.deviceSettings?.wifiOnly || false}
                            onChange={(e) => setFormData({...formData, deviceSettings: {...formData.deviceSettings, wifiOnly: e.target.checked}})}
                            className="rounded text-blue-600" />
                          <span className="text-sm">仅在连接 Wi-Fi 时投放</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* 优化目标 */}
            <div className="border-t pt-4 mt-4">
              <h4 className="text-sm font-medium text-slate-700 mb-3">优化目标</h4>
              <select value={formData.optimizationGoal || 'OFFSITE_CONVERSIONS'} onChange={(e) => setFormData({...formData, optimizationGoal: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                <option value="OFFSITE_CONVERSIONS">网站转化</option>
                <option value="LINK_CLICKS">链接点击</option>
                <option value="LANDING_PAGE_VIEWS">落地页浏览</option>
                <option value="IMPRESSIONS">展示次数</option>
                <option value="REACH">覆盖人数</option>
              </select>
            </div>
          </div>
        )
      case 'copywriting':
        return (
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-600 mb-1">名称 *</label>
              <input type="text" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            <div><label className="block text-sm text-slate-600 mb-1">正文（每行一条）</label>
              <textarea value={formData.content?.primaryTexts?.join('\n') || ''} onChange={(e) => setFormData({...formData, content: {...formData.content, primaryTexts: e.target.value.split('\n').filter(Boolean)}})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm text-slate-600 mb-1">标题（每行一条）</label>
              <textarea value={formData.content?.headlines?.join('\n') || ''} onChange={(e) => setFormData({...formData, content: {...formData.content, headlines: e.target.value.split('\n').filter(Boolean)}})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm text-slate-600 mb-1">描述（每行一条）</label>
              <textarea value={formData.content?.descriptions?.join('\n') || ''} onChange={(e) => setFormData({...formData, content: {...formData.content, descriptions: e.target.value.split('\n').filter(Boolean)}})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm text-slate-600 mb-1">行动号召按钮</label>
              <select value={formData.callToAction || 'SHOP_NOW'} onChange={(e) => setFormData({...formData, callToAction: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
                <option value="SHOP_NOW">立即购买</option><option value="LEARN_MORE">了解更多</option><option value="SIGN_UP">注册</option><option value="DOWNLOAD">下载</option><option value="GET_OFFER">领取优惠</option>
              </select></div>
            <div><label className="block text-sm text-slate-600 mb-1">落地页 URL</label>
              <input type="url" value={formData.links?.websiteUrl || ''} onChange={(e) => setFormData({...formData, links: {...formData.links, websiteUrl: e.target.value}})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        )
      case 'creative':
        return (
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-600 mb-1">名称 *</label>
              <input type="text" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            <div><label className="block text-sm text-slate-600 mb-1">广告格式</label>
              <select value={formData.config?.format || 'single'} onChange={(e) => setFormData({...formData, config: {...formData.config, format: e.target.value}})} className="w-full px-3 py-2 border rounded-lg">
                <option value="single">单图/视频</option><option value="carousel">轮播</option>
              </select></div>
            
            {/* 素材选择 */}
            <div>
              <label className="block text-sm text-slate-600 mb-2">素材</label>
              <button
                type="button"
                onClick={openMaterialPicker}
                className="w-full px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-slate-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                从素材库选择
              </button>
              
              {/* 已选素材列表 */}
              {formData.materials?.length > 0 && (
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {formData.materials.map((m: any, i: number) => (
                    <div key={i} className="relative group aspect-square bg-slate-100 rounded-lg overflow-hidden">
                      {m.type === 'image' ? (
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <VideoThumbnail src={m.url} className="w-full h-full" />
                      )}
                      <button
                        onClick={() => removeMaterial(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-3 h-3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div><label className="block text-sm text-slate-600 mb-1">描述</label>
              <textarea value={formData.description || ''} onChange={(e) => setFormData({...formData, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        )
      default:
        return null
    }
  }
  
  const renderItem = (item: any) => {
    switch (activeTab) {
      case 'targeting':
        return (
          <div className="p-4 border rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <div className="font-semibold">{item.name}</div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(item)} className="text-xs text-blue-500 hover:underline">编辑</button>
                <button onClick={() => handleDelete(item._id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </div>
            <div className="text-sm text-slate-600 space-y-1">
              <div>
                {item.geoLocations?.countries?.length > 0 && <span className="mr-3">🌍 {item.geoLocations.countries.join(', ')}</span>}
                <span className="mr-3">👤 {item.demographics?.ageMin || 18}-{item.demographics?.ageMax || 65}岁</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block px-2 py-0.5 bg-slate-100 rounded text-xs">
                  {item.placement?.type === 'manual' ? '手动版位' : '自动版位'}
                </span>
                <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">
                  {item.optimizationGoal === 'OFFSITE_CONVERSIONS' ? '转化' : 
                   item.optimizationGoal === 'LINK_CLICKS' ? '点击' : 
                   item.optimizationGoal === 'LANDING_PAGE_VIEWS' ? '浏览' : 
                   item.optimizationGoal || '转化'}
                </span>
              </div>
            </div>
          </div>
        )
      case 'copywriting':
        return (
          <div className="p-4 border rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <div className="font-semibold">{item.name}</div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(item)} className="text-xs text-blue-500 hover:underline">编辑</button>
                <button onClick={() => handleDelete(item._id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </div>
            <div className="text-sm text-slate-600 mb-2">
              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-600 rounded text-xs">{item.callToAction}</span>
            </div>
            {item.content?.primaryTexts?.[0] && <div className="text-sm text-slate-700 line-clamp-2">{item.content.primaryTexts[0]}</div>}
          </div>
        )
      case 'creative':
        return (
          <div className="p-4 border rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <div className="font-semibold">{item.name}</div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(item)} className="text-xs text-blue-500 hover:underline">编辑</button>
                <button onClick={() => handleDelete(item._id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </div>
            <div className="text-sm text-slate-600 mb-2">
              <span className="mr-3">📷 {item.materialStats?.imageCount || 0} 图片</span>
              <span className="mr-3">🎬 {item.materialStats?.videoCount || 0} 视频</span>
              <span className="inline-block px-2 py-0.5 bg-slate-100 rounded text-xs">{item.config?.format || 'single'}</span>
            </div>
            {/* 素材预览 */}
            {item.materials?.length > 0 && (
              <div className="flex gap-1 mt-2">
                {item.materials.slice(0, 4).map((m: any, i: number) => (
                  <div key={i} className="w-10 h-10 bg-slate-100 rounded overflow-hidden">
                    {m.type === 'image' ? (
                      <img src={m.url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <VideoThumbnail src={m.url} className="w-full h-full" />
                    )}
                  </div>
                ))}
                {item.materials.length > 4 && (
                  <div className="w-10 h-10 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-500">
                    +{item.materials.length - 4}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      default:
        return null
    }
  }
  
  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">资产管理</h1>
            <p className="text-slate-500 mt-1">管理定向包、文案包和创意组</p>
          </div>
          <button onClick={() => navigate('/bulk-ad/create')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">创建广告</button>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-6">
          {(Object.keys(TAB_CONFIG) as AssetType[]).map(tab => (
            <button key={tab} onClick={() => handleTabChange(tab)} className={`px-6 py-3 text-sm font-medium transition-colors ${activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}>
              {TAB_CONFIG[tab].label}
            </button>
          ))}
        </div>
        
        {/* Action bar */}
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-slate-500">共 {items.length} 个{TAB_CONFIG[activeTab].label}</span>
          <button onClick={() => { setFormData({}); setShowForm(true) }} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm">+ 新建{TAB_CONFIG[activeTab].label}</button>
        </div>
        
        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">{formData._id ? '编辑' : '新建'}{TAB_CONFIG[activeTab].label}</h3>
              {renderForm()}
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowForm(false); setFormData({}) }} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">取消</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">{saving ? '保存中...' : '保存'}</button>
              </div>
            </div>
          </div>
        )}
        
        {/* Material Picker Modal */}
        {showMaterialPicker && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
              <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-lg font-semibold">选择素材</h3>
                <button onClick={() => setShowMaterialPicker(false)} className="text-slate-400 hover:text-slate-600">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Filters */}
              <div className="p-4 border-b border-slate-200 flex gap-4">
                <select
                  value={materialFilter.folder}
                  onChange={(e) => { setMaterialFilter(f => ({ ...f, folder: e.target.value })); setTimeout(loadMaterials, 0) }}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="">全部文件夹</option>
                  {folders.map(f => (
                    <option key={f._id} value={f.path}>{f.name} ({f.count})</option>
                  ))}
                </select>
                <select
                  value={materialFilter.type}
                  onChange={(e) => { setMaterialFilter(f => ({ ...f, type: e.target.value })); setTimeout(loadMaterials, 0) }}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                >
                  <option value="">全部类型</option>
                  <option value="image">图片</option>
                  <option value="video">视频</option>
                </select>
                <span className="ml-auto text-sm text-slate-500">
                  已选 {selectedMaterials.length} 个
                </span>
              </div>
              
              {/* Materials Grid */}
              <div className="flex-1 overflow-y-auto p-4">
                {loadingMaterials ? (
                  <div className="text-center py-12 text-slate-500">加载中...</div>
                ) : materials.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <p>暂无素材</p>
                    <button
                      onClick={() => { setShowMaterialPicker(false); navigate('/bulk-ad/materials') }}
                      className="mt-2 text-blue-600 hover:underline text-sm"
                    >
                      前往素材库上传
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-3">
                    {materials.map(m => {
                      const isSelected = selectedMaterials.some(s => s._id === m._id)
                      return (
                        <div
                          key={m._id}
                          onClick={() => toggleMaterialSelect(m)}
                          className={`cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                            isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-transparent hover:border-slate-300'
                          }`}
                        >
                          <div className="aspect-square bg-slate-100 relative">
                            {m.type === 'image' ? (
                              <img src={m.storage.url} alt={m.name} className="w-full h-full object-cover" />
                            ) : (
                              <VideoThumbnail src={m.storage.url} className="w-full h-full" />
                            )}
                            {isSelected && (
                              <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="white" className="w-3 h-3">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-center truncate p-1">{m.name}</p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              
              {/* Footer */}
              <div className="p-4 border-t border-slate-200 flex justify-end gap-3">
                <button onClick={() => setShowMaterialPicker(false)} className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50">取消</button>
                <button
                  onClick={confirmMaterialSelection}
                  disabled={selectedMaterials.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  确认选择 ({selectedMaterials.length})
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Items list */}
        {loading ? (
          <div className="text-center py-12 text-slate-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-slate-500">暂无{TAB_CONFIG[activeTab].label}，点击上方按钮创建</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {items.map(item => <div key={item._id}>{renderItem(item)}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
