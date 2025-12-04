import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'

const API_BASE = '/api'

type AssetType = 'targeting' | 'copywriting' | 'creative'

const TAB_CONFIG = {
  targeting: { label: '定向包', endpoint: 'targeting-packages' },
  copywriting: { label: '文案包', endpoint: 'copywriting-packages' },
  creative: { label: '创意组', endpoint: 'creative-groups' },
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
  
  const renderForm = () => {
    switch (activeTab) {
      case 'targeting':
        return (
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-600 mb-1">名称 *</label>
              <input type="text" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            <div><label className="block text-sm text-slate-600 mb-1">账户 ID *</label>
              <input type="text" value={formData.accountId || ''} onChange={(e) => setFormData({...formData, accountId: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            <div><label className="block text-sm text-slate-600 mb-1">国家（逗号分隔）</label>
              <input type="text" value={formData.geoLocations?.countries?.join(',') || ''} onChange={(e) => setFormData({...formData, geoLocations: {...formData.geoLocations, countries: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean)}})} placeholder="US,CA,GB" className="w-full px-3 py-2 border rounded-lg" /></div>
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
        )
      case 'copywriting':
        return (
          <div className="space-y-4">
            <div><label className="block text-sm text-slate-600 mb-1">名称 *</label>
              <input type="text" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            <div><label className="block text-sm text-slate-600 mb-1">账户 ID *</label>
              <input type="text" value={formData.accountId || ''} onChange={(e) => setFormData({...formData, accountId: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
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
            <div><label className="block text-sm text-slate-600 mb-1">账户 ID *</label>
              <input type="text" value={formData.accountId || ''} onChange={(e) => setFormData({...formData, accountId: e.target.value})} className="w-full px-3 py-2 border rounded-lg" required /></div>
            <div><label className="block text-sm text-slate-600 mb-1">广告格式</label>
              <select value={formData.config?.format || 'single'} onChange={(e) => setFormData({...formData, config: {...formData.config, format: e.target.value}})} className="w-full px-3 py-2 border rounded-lg">
                <option value="single">单图/视频</option><option value="carousel">轮播</option>
              </select></div>
            <div><label className="block text-sm text-slate-600 mb-1">素材 URL（每行一个）</label>
              <textarea value={formData.materials?.map((m: any) => m.url).join('\n') || ''} onChange={(e) => setFormData({...formData, materials: e.target.value.split('\n').filter(Boolean).map((url: string) => ({ type: url.match(/\.(mp4|mov|webm)$/i) ? 'video' : 'image', url, status: 'pending' }))})} rows={4} placeholder="https://example.com/image.jpg" className="w-full px-3 py-2 border rounded-lg" /></div>
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
              <div><div className="font-semibold">{item.name}</div><div className="text-xs text-slate-500">{item.accountId}</div></div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(item)} className="text-xs text-blue-500 hover:underline">编辑</button>
                <button onClick={() => handleDelete(item._id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </div>
            <div className="text-sm text-slate-600">
              {item.geoLocations?.countries?.length > 0 && <span className="mr-3">🌍 {item.geoLocations.countries.join(', ')}</span>}
              <span className="mr-3">👤 {item.demographics?.ageMin || 18}-{item.demographics?.ageMax || 65}岁</span>
              {item.interests?.length > 0 && <span>🎯 {item.interests.length} 个兴趣</span>}
            </div>
          </div>
        )
      case 'copywriting':
        return (
          <div className="p-4 border rounded-lg hover:border-slate-300 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <div><div className="font-semibold">{item.name}</div><div className="text-xs text-slate-500">{item.accountId}</div></div>
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
              <div><div className="font-semibold">{item.name}</div><div className="text-xs text-slate-500">{item.accountId}</div></div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(item)} className="text-xs text-blue-500 hover:underline">编辑</button>
                <button onClick={() => handleDelete(item._id)} className="text-xs text-red-500 hover:underline">删除</button>
              </div>
            </div>
            <div className="text-sm text-slate-600">
              <span className="mr-3">📷 {item.materialStats?.imageCount || 0} 图片</span>
              <span className="mr-3">🎬 {item.materialStats?.videoCount || 0} 视频</span>
              <span className="inline-block px-2 py-0.5 bg-slate-100 rounded text-xs">{item.config?.format || 'single'}</span>
            </div>
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

