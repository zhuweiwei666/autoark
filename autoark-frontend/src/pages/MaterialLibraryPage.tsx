import { useState, useEffect, useRef } from 'react'

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
  
  // 当前选中的文件夹
  const [currentFolder, setCurrentFolder] = useState<string>('全部文件')
  
  // 筛选条件
  const [filter, setFilter] = useState({
    type: '',
    search: '',
  })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 24
  
  // 选中状态
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMaterial, setViewMaterial] = useState<Material | null>(null)
  
  // 配置状态
  const [configStatus, setConfigStatus] = useState<{ configured: boolean; missing: string[] } | null>(null)
  
  // 文件夹操作
  const [editingFolder, setEditingFolder] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folder: string } | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  
  useEffect(() => {
    checkConfig()
    loadFolders()
  }, [])
  
  useEffect(() => {
    loadMaterials()
  }, [currentFolder, filter, page])
  
  useEffect(() => {
    if (isCreatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus()
    }
  }, [isCreatingFolder])
  
  // 点击空白处关闭右键菜单
  useEffect(() => {
    const handleClick = () => setFolderContextMenu(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])
  
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
      if (currentFolder !== '全部文件') params.append('folder', currentFolder)
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
    
    const formData = new FormData()
    const fileArray = Array.from(files)
    const targetFolder = currentFolder === '全部文件' ? '默认' : currentFolder
    
    if (fileArray.length === 1) {
      formData.append('file', fileArray[0])
      formData.append('folder', targetFolder)
      
      try {
        const res = await fetch(`${API_BASE}/materials/upload`, {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.success) {
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
      formData.append('folder', targetFolder)
      
      try {
        const res = await fetch(`${API_BASE}/materials/upload-batch`, {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.success) {
          alert(`上传完成：成功 ${data.data.successCount} 个`)
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
        setViewMaterial(null)
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
  
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  
  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    alert('URL 已复制到剪贴板')
  }
  
  // 创建文件夹
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) {
      setIsCreatingFolder(false)
      return
    }
    if (folders.some(f => f.name === newFolderName.trim())) {
      alert('文件夹已存在')
      return
    }
    setFolders([...folders, { name: newFolderName.trim(), count: 0 }])
    setCurrentFolder(newFolderName.trim())
    setNewFolderName('')
    setIsCreatingFolder(false)
  }
  
  // 重命名文件夹
  const handleRenameFolder = async (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) {
      setEditingFolder(null)
      return
    }
    if (folders.some(f => f.name === newName.trim() && f.name !== oldName)) {
      alert('文件夹名称已存在')
      return
    }
    
    try {
      const res = await fetch(`${API_BASE}/materials/rename-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldName, newName: newName.trim() }),
      })
      const data = await res.json()
      if (data.success) {
        if (currentFolder === oldName) {
          setCurrentFolder(newName.trim())
        }
        loadFolders()
      } else {
        alert(`重命名失败：${data.error}`)
      }
    } catch (err: any) {
      alert(`重命名失败：${err.message}`)
    }
    setEditingFolder(null)
  }
  
  // 删除文件夹
  const handleDeleteFolder = async (folderName: string) => {
    const folder = folders.find(f => f.name === folderName)
    if (folder && folder.count > 0) {
      if (!confirm(`文件夹 "${folderName}" 中有 ${folder.count} 个素材，删除后素材将移至"默认"文件夹。确定删除？`)) {
        return
      }
    } else {
      if (!confirm(`确定删除文件夹 "${folderName}" 吗？`)) {
        return
      }
    }
    
    try {
      const res = await fetch(`${API_BASE}/materials/delete-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName }),
      })
      const data = await res.json()
      if (data.success) {
        if (currentFolder === folderName) {
          setCurrentFolder('全部文件')
        }
        loadFolders()
        loadMaterials()
      } else {
        alert(`删除失败：${data.error}`)
      }
    } catch (err: any) {
      alert(`删除失败：${err.message}`)
    }
  }
  
  // 移动素材到文件夹
  const handleMoveToFolder = async (targetFolder: string) => {
    if (selectedIds.length === 0) return
    
    try {
      const res = await fetch(`${API_BASE}/materials/move-to-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, folder: targetFolder }),
      })
      const data = await res.json()
      if (data.success) {
        setSelectedIds([])
        loadMaterials()
        loadFolders()
      } else {
        alert(`移动失败：${data.error}`)
      }
    } catch (err: any) {
      alert(`移动失败：${err.message}`)
    }
  }
  
  // 计算总数
  const totalCount = folders.reduce((sum, f) => sum + f.count, 0)
  
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
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-3">
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
          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 text-sm"
        >
          {uploading ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              上传中...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              上传
            </>
          )}
        </button>
        
        <div className="w-px h-6 bg-slate-200" />
        
        <button
          onClick={() => setIsCreatingFolder(true)}
          className="px-3 py-1.5 text-slate-700 hover:bg-slate-100 rounded flex items-center gap-1.5 text-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          新建文件夹
        </button>
        
        {selectedIds.length > 0 && (
          <>
            <div className="w-px h-6 bg-slate-200" />
            
            <div className="relative group">
              <button className="px-3 py-1.5 text-slate-700 hover:bg-slate-100 rounded flex items-center gap-1.5 text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                </svg>
                移动到
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px] hidden group-hover:block z-20">
                {folders.map(f => (
                  <button
                    key={f.name}
                    onClick={() => handleMoveToFolder(f.name)}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4 text-amber-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
            
            <button
              onClick={handleBatchDelete}
              className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded flex items-center gap-1.5 text-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              删除 ({selectedIds.length})
            </button>
          </>
        )}
        
        <div className="flex-1" />
        
        {/* Type Filter */}
        <select
          value={filter.type}
          onChange={(e) => { setFilter(f => ({ ...f, type: e.target.value })); setPage(1) }}
          className="px-3 py-1.5 border border-slate-200 rounded text-sm"
        >
          <option value="">全部类型</option>
          <option value="image">图片</option>
          <option value="video">视频</option>
        </select>
        
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="搜索..."
            value={filter.search}
            onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && loadMaterials()}
            className="w-48 px-3 py-1.5 pl-8 border border-slate-200 rounded text-sm"
          />
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Folder Tree */}
        <div className="w-56 bg-slate-50 border-r border-slate-200 overflow-y-auto">
          <div className="p-2">
            {/* All Files */}
            <button
              onClick={() => { setCurrentFolder('全部文件'); setPage(1) }}
              className={`w-full px-3 py-2 rounded flex items-center gap-2 text-sm ${
                currentFolder === '全部文件' ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <span className="flex-1 text-left">全部文件</span>
              <span className="text-xs text-slate-400">{totalCount}</span>
            </button>
            
            <div className="mt-2 pt-2 border-t border-slate-200">
              <div className="px-3 py-1 text-xs text-slate-400 uppercase tracking-wider">文件夹</div>
              
              {/* Folder List */}
              {folders.map(f => (
                <div
                  key={f.name}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setFolderContextMenu({ x: e.clientX, y: e.clientY, folder: f.name })
                  }}
                >
                  {editingFolder === f.name ? (
                    <input
                      type="text"
                      defaultValue={f.name}
                      autoFocus
                      className="w-full px-3 py-2 text-sm border border-blue-400 rounded outline-none"
                      onBlur={(e) => handleRenameFolder(f.name, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleRenameFolder(f.name, (e.target as HTMLInputElement).value)
                        } else if (e.key === 'Escape') {
                          setEditingFolder(null)
                        }
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => { setCurrentFolder(f.name); setPage(1) }}
                      onDoubleClick={() => setEditingFolder(f.name)}
                      className={`w-full px-3 py-2 rounded flex items-center gap-2 text-sm ${
                        currentFolder === f.name ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-amber-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      <span className="flex-1 text-left truncate">{f.name}</span>
                      <span className="text-xs text-slate-400">{f.count}</span>
                    </button>
                  )}
                </div>
              ))}
              
              {/* New Folder Input */}
              {isCreatingFolder && (
                <div className="px-3 py-1">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-amber-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    <input
                      ref={newFolderInputRef}
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="文件夹名称"
                      className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded outline-none"
                      onBlur={handleCreateFolder}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleCreateFolder()
                        } else if (e.key === 'Escape') {
                          setIsCreatingFolder(false)
                          setNewFolderName('')
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-white">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-4 text-sm text-slate-500">
            <button
              onClick={() => { setCurrentFolder('全部文件'); setPage(1) }}
              className="hover:text-blue-600"
            >
              素材库
            </button>
            {currentFolder !== '全部文件' && (
              <>
                <span>/</span>
                <span className="text-slate-700">{currentFolder}</span>
              </>
            )}
            <span className="ml-auto text-slate-400">{total} 项</span>
          </div>
          
          {/* Materials Grid */}
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="text-slate-500">加载中...</div>
            </div>
          ) : materials.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor" className="w-16 h-16 mb-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <p>文件夹为空</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                上传素材
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {materials.map(m => (
                  <div
                    key={m._id}
                    className={`relative group cursor-pointer transition-all ${
                      selectedIds.includes(m._id) ? 'ring-2 ring-blue-500 rounded-lg' : ''
                    }`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        toggleSelect(m._id)
                      } else {
                        setViewMaterial(m)
                      }
                    }}
                  >
                    {/* Checkbox */}
                    <div
                      className={`absolute top-1 left-1 z-10 transition-opacity ${
                        selectedIds.includes(m._id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                      onClick={(e) => { e.stopPropagation(); toggleSelect(m._id) }}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedIds.includes(m._id) 
                          ? 'bg-blue-600 border-blue-600' 
                          : 'bg-white/90 border-slate-300'
                      }`}>
                        {selectedIds.includes(m._id) && (
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="white" className="w-3 h-3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        )}
                      </div>
                    </div>
                    
                    {/* Preview */}
                    <div className="aspect-square bg-slate-100 rounded-lg overflow-hidden">
                      {m.type === 'image' ? (
                        <img 
                          src={m.storage.url} 
                          alt={m.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-800">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-8 h-8 text-white">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    
                    {/* Name */}
                    <p className="mt-1 text-xs text-slate-600 truncate text-center" title={m.name}>
                      {m.name}
                    </p>
                  </div>
                ))}
              </div>
              
              {/* Pagination */}
              {total > pageSize && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 border border-slate-200 rounded text-sm disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-slate-500">
                    {page} / {Math.ceil(total / pageSize)}
                  </span>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= total}
                    className="px-3 py-1.5 border border-slate-200 rounded text-sm disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Folder Context Menu */}
      {folderContextMenu && (
        <div
          className="fixed bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[120px] z-50"
          style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { setEditingFolder(folderContextMenu.folder); setFolderContextMenu(null) }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
            重命名
          </button>
          <button
            onClick={() => { handleDeleteFolder(folderContextMenu.folder); setFolderContextMenu(null) }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            删除
          </button>
        </div>
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
              <div className="flex justify-end mt-4 pt-4 border-t border-slate-200">
                <button
                  onClick={() => handleDelete(viewMaterial._id)}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded text-sm flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  删除素材
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
