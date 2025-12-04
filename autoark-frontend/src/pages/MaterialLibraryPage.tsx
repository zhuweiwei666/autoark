import { useState, useEffect, useRef, useCallback } from 'react'

const API_BASE = '/api'

interface Material {
  _id: string
  name: string
  type: 'image' | 'video'
  status: string
  storage: {
    url: string
    key?: string
  }
  file: {
    originalName: string
    mimeType: string
    size: number
    width?: number
    height?: number
    duration?: number
  }
  tags: string[]
  folder: string
  usageCount: number
  createdAt: string
  fileSizeFormatted?: string
}

interface FolderInfo {
  name: string
  count: number
}

export default function MaterialLibraryPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // 筛选条件
  const [filter, setFilter] = useState({
    type: '',
    folder: '',
    search: '',
  })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 20
  
  // 选中状态
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMaterial, setViewMaterial] = useState<Material | null>(null)
  
  // 配置状态
  const [configStatus, setConfigStatus] = useState<{ configured: boolean; missing: string[] } | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  useEffect(() => {
    checkConfig()
    loadFolders()
  }, [])
  
  useEffect(() => {
    loadMaterials()
  }, [filter, page])
  
  const checkConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/materials/config-status`)
      const data = await res.json()
      if (data.success) {
        setConfigStatus(data.data)
      }
    } catch (err) {
      console.error('Failed to check config:', err)
    }
  }
  
  const loadFolders = async () => {
    try {
      const res = await fetch(`${API_BASE}/materials/folders`)
      const data = await res.json()
      if (data.success) {
        setFolders(data.data || [])
      }
    } catch (err) {
      console.error('Failed to load folders:', err)
    }
  }
  
  const loadMaterials = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })
      if (filter.type) params.append('type', filter.type)
      if (filter.folder) params.append('folder', filter.folder)
      if (filter.search) params.append('search', filter.search)
      
      const res = await fetch(`${API_BASE}/materials?${params}`)
      const data = await res.json()
      if (data.success) {
        setMaterials(data.data.list || [])
        setTotal(data.data.total || 0)
      }
    } catch (err) {
      console.error('Failed to load materials:', err)
    } finally {
      setLoading(false)
    }
  }
  
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    
    setUploading(true)
    setUploadProgress(0)
    
    const formData = new FormData()
    const fileArray = Array.from(files)
    
    if (fileArray.length === 1) {
      formData.append('file', fileArray[0])
      formData.append('folder', filter.folder || '默认')
      
      try {
        const res = await fetch(`${API_BASE}/materials/upload`, {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.success) {
          alert('上传成功！')
          loadMaterials()
          loadFolders()
        } else {
          alert(`上传失败：${data.error}`)
        }
      } catch (err: any) {
        alert(`上传失败：${err.message}`)
      }
    } else {
      fileArray.forEach(f => formData.append('files', f))
      formData.append('folder', filter.folder || '默认')
      
      try {
        const res = await fetch(`${API_BASE}/materials/upload-batch`, {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.success) {
          alert(`批量上传完成！成功 ${data.data.successCount} 个，失败 ${data.data.failCount} 个`)
          loadMaterials()
          loadFolders()
        } else {
          alert(`上传失败：${data.error}`)
        }
      } catch (err: any) {
        alert(`上传失败：${err.message}`)
      }
    }
    
    setUploading(false)
    setUploadProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  
  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个素材吗？')) return
    
    try {
      const res = await fetch(`${API_BASE}/materials/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        loadMaterials()
        loadFolders()
      } else {
        alert(`删除失败：${data.error}`)
      }
    } catch (err: any) {
      alert(`删除失败：${err.message}`)
    }
  }
  
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.length} 个素材吗？`)) return
    
    try {
      const res = await fetch(`${API_BASE}/materials/delete-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      })
      const data = await res.json()
      if (data.success) {
        setSelectedIds([])
        loadMaterials()
        loadFolders()
      } else {
        alert(`删除失败：${data.error}`)
      }
    } catch (err: any) {
      alert(`删除失败：${err.message}`)
    }
  }
  
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }
  
  const toggleSelectAll = () => {
    if (selectedIds.length === materials.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(materials.map(m => m._id))
    }
  }
  
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  
  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    alert('URL 已复制到剪贴板')
  }
  
  // 配置未完成提示
  if (configStatus && !configStatus.configured) {
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-yellow-800 mb-2">⚠️ R2 存储未配置</h2>
          <p className="text-yellow-700 mb-4">请在服务器 .env 文件中配置以下环境变量：</p>
          <ul className="list-disc list-inside text-yellow-700 space-y-1 font-mono text-sm">
            {configStatus.missing.map(m => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div className="mt-4 p-3 bg-white rounded-lg text-sm">
            <p className="text-slate-600 mb-2">示例配置：</p>
            <pre className="text-xs bg-slate-100 p-2 rounded overflow-x-auto">
{`R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET_NAME=your_bucket_name
R2_PUBLIC_URL=https://pub-xxx.r2.dev`}
            </pre>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">素材库</h1>
            <p className="text-slate-500 mt-1">管理图片和视频素材，用于广告创意</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  上传中...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  上传素材
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Type Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">类型：</span>
              <select
                value={filter.type}
                onChange={(e) => { setFilter(f => ({ ...f, type: e.target.value })); setPage(1) }}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">全部</option>
                <option value="image">图片</option>
                <option value="video">视频</option>
              </select>
            </div>
            
            {/* Folder Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">文件夹：</span>
              <select
                value={filter.folder}
                onChange={(e) => { setFilter(f => ({ ...f, folder: e.target.value })); setPage(1) }}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">全部</option>
                {folders.map(f => (
                  <option key={f.name} value={f.name}>{f.name} ({f.count})</option>
                ))}
              </select>
            </div>
            
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="搜索素材名称..."
                value={filter.search}
                onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && loadMaterials()}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            
            {/* Batch Actions */}
            {selectedIds.length > 0 && (
              <button
                onClick={handleBatchDelete}
                className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
              >
                删除选中 ({selectedIds.length})
              </button>
            )}
          </div>
        </div>
        
        {/* Materials Grid */}
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="text-slate-500">加载中...</div>
          </div>
        ) : materials.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-12 h-12 mx-auto text-slate-300 mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <p className="text-slate-500 mb-4">还没有素材</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              上传第一个素材
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mb-6">
              {materials.map(m => (
                <div
                  key={m._id}
                  className={`relative group bg-white rounded-xl border overflow-hidden cursor-pointer transition-all hover:shadow-lg ${
                    selectedIds.includes(m._id) ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className="absolute top-2 left-2 z-10"
                    onClick={(e) => { e.stopPropagation(); toggleSelect(m._id) }}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      selectedIds.includes(m._id) 
                        ? 'bg-blue-600 border-blue-600' 
                        : 'bg-white/80 border-slate-300 group-hover:border-blue-400'
                    }`}>
                      {selectedIds.includes(m._id) && (
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="white" className="w-3 h-3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </div>
                  </div>
                  
                  {/* Preview */}
                  <div 
                    className="aspect-square bg-slate-100 relative"
                    onClick={() => setViewMaterial(m)}
                  >
                    {m.type === 'image' ? (
                      <img 
                        src={m.storage.url} 
                        alt={m.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-800">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-12 h-12 text-white">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                        </svg>
                      </div>
                    )}
                    
                    {/* Type Badge */}
                    <div className="absolute top-2 right-2">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        m.type === 'image' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {m.type === 'image' ? '图片' : '视频'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Info */}
                  <div className="p-2">
                    <p className="text-sm font-medium text-slate-700 truncate" title={m.name}>{m.name}</p>
                    <p className="text-xs text-slate-400">{formatSize(m.file.size)}</p>
                  </div>
                  
                  {/* Hover Actions */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); copyUrl(m.storage.url) }}
                      className="px-3 py-1.5 bg-white text-slate-700 rounded text-sm hover:bg-slate-100"
                    >
                      复制链接
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(m._id) }}
                      className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Pagination */}
            {total > pageSize && (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm disabled:opacity-50"
                >
                  上一页
                </button>
                <span className="text-sm text-slate-500">
                  第 {page} 页，共 {Math.ceil(total / pageSize)} 页
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * pageSize >= total}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
        
        {/* View Modal */}
        {viewMaterial && (
          <div 
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={() => setViewMaterial(null)}
          >
            <div 
              className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-slate-200">
                <h3 className="font-semibold">{viewMaterial.name}</h3>
                <button onClick={() => setViewMaterial(null)} className="text-slate-400 hover:text-slate-600">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-4">
                <div className="bg-slate-100 rounded-lg overflow-hidden mb-4">
                  {viewMaterial.type === 'image' ? (
                    <img src={viewMaterial.storage.url} alt={viewMaterial.name} className="max-w-full max-h-[60vh] mx-auto" />
                  ) : (
                    <video src={viewMaterial.storage.url} controls className="max-w-full max-h-[60vh] mx-auto" />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">类型：</span>
                    <span className="ml-2">{viewMaterial.type === 'image' ? '图片' : '视频'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">大小：</span>
                    <span className="ml-2">{formatSize(viewMaterial.file.size)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">文件夹：</span>
                    <span className="ml-2">{viewMaterial.folder}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">上传时间：</span>
                    <span className="ml-2">{new Date(viewMaterial.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                </div>
                <div className="mt-4">
                  <span className="text-slate-500 text-sm">URL：</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input 
                      type="text" 
                      readOnly 
                      value={viewMaterial.storage.url}
                      className="flex-1 px-3 py-2 bg-slate-100 border border-slate-200 rounded text-sm"
                    />
                    <button
                      onClick={() => copyUrl(viewMaterial.storage.url)}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                    >
                      复制
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

