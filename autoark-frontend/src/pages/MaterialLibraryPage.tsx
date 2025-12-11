import { useState, useEffect, useRef } from 'react'

const API_BASE = '/api'

// 视频缩略图组件 - 显示首帧
function VideoThumbnail({ src, className }: { src: string; className?: string }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'
    
    video.onloadeddata = () => {
      video.currentTime = 0.1 // 跳到0.1秒获取首帧
    }
    
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
      } catch (e) {
        console.error('Failed to generate thumbnail:', e)
      }
      setLoading(false)
    }
    
    video.onerror = () => {
      setLoading(false)
    }
    
    video.src = src
    
    return () => {
      video.src = ''
    }
  }, [src])
  
  if (loading || !thumbnail) {
    return (
      <div className={`flex items-center justify-center bg-slate-800 ${className}`}>
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-8 h-8 text-white">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      </div>
    )
  }
  
  return (
    <div className={`relative ${className}`}>
      <img src={thumbnail} alt="视频封面" className="w-full h-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="white" className="w-5 h-5 ml-0.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
          </svg>
        </div>
      </div>
    </div>
  )
}

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
}

interface Folder {
  _id: string
  name: string
  parentId: string | null
  path: string
  level: number
  count: number
}

export default function MaterialLibraryPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // 当前选中的文件夹路径
  const [currentPath, setCurrentPath] = useState<string>('')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  
  // 筛选
  const [filter, setFilter] = useState({ type: '', search: '' })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const pageSize = 24
  
  // 选中状态
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewMaterial, setViewMaterial] = useState<Material | null>(null)
  
  // 配置状态
  const [configStatus, setConfigStatus] = useState<{ configured: boolean; missing: string[] } | null>(null)
  
  // 文件夹操作
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [creatingInParent, setCreatingInParent] = useState<string | null>(null) // null = 根目录创建
  const [newFolderName, setNewFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder: Folder } | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const newFolderInputRef = useRef<HTMLInputElement>(null)
  
  useEffect(() => {
    checkConfig()
    loadFolders()
  }, [])
  
  useEffect(() => {
    loadMaterials()
  }, [currentPath, filter, page])
  
  useEffect(() => {
    if ((creatingInParent !== null || creatingInParent === '') && newFolderInputRef.current) {
      newFolderInputRef.current.focus()
    }
  }, [creatingInParent])
  
  // 点击空白处关闭右键菜单
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
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
      const res = await fetch(`${API_BASE}/materials/folder-tree`)
      const data = await res.json()
      if (data.success) {
        setFolders(data.data.folders || [])
        setTotalCount(data.data.totalCount || 0)
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
      if (currentPath) params.append('folder', currentPath)
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
  
  // 直传 R2 上传（更快，跳过服务器）
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    
    setUploading(true)
    setUploadProgress(0)
    
    const fileArray = Array.from(files)
    const targetFolder = currentPath || '默认'
    const totalFiles = fileArray.length
    let uploadedCount = 0
    let failedCount = 0
    const uploadedFiles: Array<{ fileName: string; key: string; publicUrl: string; mimeType: string; size: number }> = []
    
    try {
      // 1. 批量获取预签名 URL
      const presignedRes = await fetch(`${API_BASE}/materials/presigned-urls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: fileArray.map(f => ({
            fileName: f.name,
            mimeType: f.type,
            size: f.size,
          })),
        }),
      })
      const presignedData = await presignedRes.json()
      
      if (!presignedData.success) {
        throw new Error(presignedData.error || '获取上传地址失败')
      }
      
      const urlMap = new Map<string, { uploadUrl: string; key: string; publicUrl: string }>(
        presignedData.data.map((u: any) => [u.fileName, u])
      )
      
      // 2. 并行直传到 R2
      const uploadPromises = fileArray.map(async (file) => {
        const urlInfo = urlMap.get(file.name)
        if (!urlInfo) {
          failedCount++
          return
        }
        
        try {
          // 直接 PUT 到 R2
          const uploadRes = await fetch(urlInfo.uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
            },
            body: file,
          })
          
          if (uploadRes.ok) {
            uploadedCount++
            uploadedFiles.push({
              fileName: file.name,
              key: urlInfo.key,
              publicUrl: urlInfo.publicUrl,
              mimeType: file.type,
              size: file.size,
            })
          } else {
            failedCount++
            console.error(`Upload failed for ${file.name}:`, uploadRes.status)
          }
        } catch (err) {
          failedCount++
          console.error(`Upload error for ${file.name}:`, err)
        }
        
        // 更新进度
        setUploadProgress(Math.round(((uploadedCount + failedCount) / totalFiles) * 100))
      })
      
      await Promise.all(uploadPromises)
      
      // 3. 确认上传完成（在数据库创建记录）
      if (uploadedFiles.length > 0) {
        const confirmRes = await fetch(`${API_BASE}/materials/confirm-uploads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: uploadedFiles,
            folder: targetFolder,
          }),
        })
        const confirmData = await confirmRes.json()
        
        if (confirmData.success) {
          const msg = totalFiles === 1 
            ? '上传成功！' 
            : `上传完成：成功 ${uploadedCount} 个${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}`
          alert(msg)
          loadMaterials()
          loadFolders()
        } else {
          alert(`保存记录失败：${confirmData.error}`)
        }
      } else if (failedCount > 0) {
        alert(`上传失败：${failedCount} 个文件上传失败`)
      }
      
    } catch (err: any) {
      console.error('Upload error:', err)
      alert(`上传失败：${err.message}`)
    } finally {
      setUploading(false)
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
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
  
  // ==================== 文件夹操作 ====================
  
  const handleCreateFolder = async (parentId: string | null) => {
    const name = newFolderName.trim()
    
    // 立即清除状态，防止重复触发
    setCreatingInParent(null)
    setNewFolderName('')
    
    if (!name) {
      return
    }
    
    try {
      const res = await fetch(`${API_BASE}/materials/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      })
      const data = await res.json()
      if (data.success) {
        loadFolders()
        // 展开父文件夹
        if (parentId) {
          setExpandedFolders(prev => new Set([...prev, parentId]))
        }
      } else {
        alert(data.error)
      }
    } catch (err: any) {
      alert(`创建失败：${err.message}`)
    }
  }
  
  const handleRenameFolder = async (folderId: string) => {
    const newName = editingName.trim()
    const folder = folders.find(f => f._id === folderId)
    
    // 立即清除状态，防止重复触发
    setEditingFolderId(null)
    setEditingName('')
    
    if (!newName || !folder || newName === folder.name) {
      return
    }
    
    try {
      const res = await fetch(`${API_BASE}/materials/rename-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, newName }),
      })
      const data = await res.json()
      if (data.success) {
        // 如果当前选中的是被重命名的文件夹，更新路径
        if (currentPath === folder.path) {
          setCurrentPath(data.data.path)
        }
        loadFolders()
        loadMaterials()
      } else {
        alert(data.error)
      }
    } catch (err: any) {
      alert(`重命名失败：${err.message}`)
    }
  }
  
  const handleDeleteFolder = async (folderId: string) => {
    const folder = folders.find(f => f._id === folderId)
    if (!folder) return
    
    const hasChildren = folders.some(f => f.parentId === folderId)
    const message = hasChildren
      ? `文件夹 "${folder.name}" 包含子文件夹，删除后所有内容将移至"默认"。确定删除？`
      : folder.count > 0
        ? `文件夹 "${folder.name}" 中有 ${folder.count} 个素材，删除后素材将移至"默认"。确定删除？`
        : `确定删除文件夹 "${folder.name}" 吗？`
    
    if (!confirm(message)) return
    
    try {
      const res = await fetch(`${API_BASE}/materials/delete-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      const data = await res.json()
      if (data.success) {
        if (currentPath === folder.path || currentPath.startsWith(folder.path + '/')) {
          setCurrentPath('')
        }
        loadFolders()
        loadMaterials()
      } else {
        alert(data.error)
      }
    } catch (err: any) {
      alert(`删除失败：${err.message}`)
    }
  }
  
  const handleMoveToFolder = async (targetPath: string) => {
    if (selectedIds.length === 0) return
    
    try {
      const res = await fetch(`${API_BASE}/materials/move-to-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, folder: targetPath }),
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
  
  const toggleExpand = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }
  
  // 获取根级文件夹
  const rootFolders = folders.filter(f => !f.parentId)
  
  // 获取子文件夹
  const getChildren = (parentId: string) => folders.filter(f => f.parentId === parentId)
  
  // 获取当前路径下的子文件夹（用于右侧内容区显示）
  const getCurrentSubfolders = (): Folder[] => {
    if (!currentPath) {
      // 根目录时，返回所有根级文件夹
      return rootFolders
    }
    // 找到当前选中的文件夹
    const currentFolder = folders.find(f => f.path === currentPath)
    if (currentFolder) {
      return getChildren(currentFolder._id)
    }
    return []
  }
  
  const currentSubfolders = getCurrentSubfolders()
  
  // 渲染文件夹树节点
  const renderFolderNode = (folder: Folder, depth: number = 0) => {
    const children = getChildren(folder._id)
    const hasChildren = children.length > 0
    const childCount = children.length // 子文件夹数量
    const isExpanded = expandedFolders.has(folder._id)
    const isSelected = currentPath === folder.path
    const isEditing = editingFolderId === folder._id
    
    return (
      <div key={folder._id}>
        <div
          className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer group ${
            isSelected ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100'
          }`}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => { setCurrentPath(folder.path); setPage(1) }}
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, folder })
          }}
        >
          {/* 展开/折叠按钮 */}
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(folder._id) }}
              className="w-4 h-4 flex items-center justify-center text-slate-400 hover:text-slate-600"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : (
            <span className="w-4" />
          )}
          
          {/* 文件夹图标 */}
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-amber-500 flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
          </svg>
          
          {/* 名称 */}
          {isEditing ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => handleRenameFolder(folder._id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameFolder(folder._id)
                if (e.key === 'Escape') { setEditingFolderId(null); setEditingName('') }
              }}
              className="flex-1 px-1 py-0.5 text-sm border border-blue-400 rounded outline-none min-w-0"
              autoFocus
            />
          ) : (
            <span className="flex-1 text-sm truncate">{folder.name}</span>
          )}
          
          {/* 子文件夹数量 */}
          {childCount > 0 && (
            <span className="text-xs text-slate-400 flex-shrink-0">{childCount}</span>
          )}
        </div>
        
        {/* 子文件夹 */}
        {hasChildren && isExpanded && (
          <div>
            {children.map(child => renderFolderNode(child, depth + 1))}
          </div>
        )}
        
        {/* 在此文件夹下创建新文件夹 */}
        {creatingInParent === folder._id && (
          <div className="flex items-center gap-1 px-2 py-1.5" style={{ paddingLeft: `${24 + depth * 16}px` }}>
            <span className="w-4" />
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-amber-500 flex-shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            <input
              ref={newFolderInputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="新文件夹"
              className="flex-1 px-1 py-0.5 text-sm border border-blue-400 rounded outline-none min-w-0"
              onBlur={() => handleCreateFolder(folder._id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder(folder._id)
                if (e.key === 'Escape') { setCreatingInParent(null); setNewFolderName('') }
              }}
            />
          </div>
        )}
      </div>
    )
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
          className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 text-sm relative overflow-hidden min-w-[80px]"
        >
          {uploading && (
            <div 
              className="absolute inset-0 bg-blue-500 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          )}
          <span className="relative flex items-center gap-1.5">
            {uploading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {uploadProgress}%
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                上传
              </>
            )}
          </span>
        </button>
        
        <div className="w-px h-6 bg-slate-200" />
        
        <button
          onClick={() => { setCreatingInParent(''); setNewFolderName('') }}
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
              <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[150px] max-h-64 overflow-y-auto hidden group-hover:block z-20">
                <button
                  onClick={() => handleMoveToFolder('默认')}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4 text-amber-500">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  默认
                </button>
                {folders.map(f => (
                  <button
                    key={f._id}
                    onClick={() => handleMoveToFolder(f.path)}
                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 flex items-center gap-2"
                    style={{ paddingLeft: `${12 + f.level * 12}px` }}
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
              onClick={() => { setCurrentPath(''); setPage(1) }}
              className={`w-full px-2 py-1.5 rounded flex items-center gap-2 text-sm ${
                currentPath === '' ? 'bg-blue-100 text-blue-700' : 'hover:bg-slate-100 text-slate-700'
              }`}
            >
              <span className="w-4" />
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <span className="flex-1 text-left">全部文件</span>
              <span className="text-xs text-slate-400">{totalCount}</span>
            </button>
            
            <div className="mt-2 pt-2 border-t border-slate-200">
              <div className="px-2 py-1 text-xs text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>文件夹</span>
              </div>
              
              {/* Root level new folder input */}
              {creatingInParent === '' && (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="w-4" />
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5 text-amber-500 flex-shrink-0">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  <input
                    ref={newFolderInputRef}
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="新文件夹"
                    className="flex-1 px-1 py-0.5 text-sm border border-blue-400 rounded outline-none min-w-0"
                    onBlur={() => handleCreateFolder(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder(null)
                      if (e.key === 'Escape') { setCreatingInParent(null); setNewFolderName('') }
                    }}
                  />
                </div>
              )}
              
              {/* Folder Tree */}
              {rootFolders.map(folder => renderFolderNode(folder))}
              
              {folders.length === 0 && creatingInParent !== '' && (
                <div className="px-2 py-4 text-center text-xs text-slate-400">
                  暂无文件夹
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 bg-white">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 mb-4 text-sm text-slate-500">
            <button onClick={() => { setCurrentPath(''); setPage(1) }} className="hover:text-blue-600">
              素材库
            </button>
            {currentPath && currentPath.split('/').map((part, i, arr) => {
              const path = arr.slice(0, i + 1).join('/')
              return (
                <span key={i} className="flex items-center gap-2">
                  <span>/</span>
                  <button
                    onClick={() => { setCurrentPath(path); setPage(1) }}
                    className={i === arr.length - 1 ? 'text-slate-700' : 'hover:text-blue-600'}
                  >
                    {part}
                  </button>
                </span>
              )
            })}
            <span className="ml-auto text-slate-400">
              {currentPath && currentSubfolders.length > 0 && `${currentSubfolders.length} 个文件夹`}
              {currentPath && currentSubfolders.length > 0 && total > 0 && '，'}
              {total > 0 && `${total} 个素材`}
              {!currentPath && `${totalCount} 项`}
              {currentPath && currentSubfolders.length === 0 && total === 0 && '0 项'}
            </span>
          </div>
          
          {/* Subfolders Grid - 显示当前路径下的子文件夹 */}
          {currentPath && currentSubfolders.length > 0 && (
            <div className="mb-6">
              <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {currentSubfolders.map(subfolder => (
                  <div
                    key={subfolder._id}
                    className="cursor-pointer group"
                    onDoubleClick={() => { 
                      setCurrentPath(subfolder.path)
                      setPage(1)
                      // 在左侧树中也展开父文件夹
                      const currentFolder = folders.find(f => f.path === currentPath)
                      if (currentFolder) {
                        setExpandedFolders(prev => new Set([...prev, currentFolder._id]))
                      }
                    }}
                  >
                    <div className="aspect-square bg-slate-50 rounded-lg overflow-hidden flex flex-col items-center justify-center border border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor" className="w-12 h-12 text-amber-400 group-hover:text-amber-500 transition-colors">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                      {/* 子文件夹数量和素材数量 */}
                      <div className="mt-1 text-xs text-slate-400">
                        {getChildren(subfolder._id).length > 0 && (
                          <span>{getChildren(subfolder._id).length} 个文件夹</span>
                        )}
                        {getChildren(subfolder._id).length > 0 && subfolder.count > 0 && <span> · </span>}
                        {subfolder.count > 0 && (
                          <span>{subfolder.count} 个素材</span>
                        )}
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-600 truncate text-center group-hover:text-blue-600 transition-colors" title={subfolder.name}>
                      {subfolder.name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Materials Grid */}
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="text-slate-500">加载中...</div>
            </div>
          ) : materials.length === 0 && currentSubfolders.length === 0 ? (
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
          ) : materials.length === 0 && currentSubfolders.length > 0 ? (
            // 只有子文件夹，没有素材时，不显示"文件夹为空"
            null
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
                        <VideoThumbnail src={m.storage.url} className="w-full h-full" />
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
      {contextMenu && (
        <div
          className="fixed bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[140px] z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { 
              setCreatingInParent(contextMenu.folder._id)
              setExpandedFolders(prev => new Set([...prev, contextMenu.folder._id]))
              setContextMenu(null) 
            }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
            </svg>
            新建子文件夹
          </button>
          <button
            onClick={() => { 
              setEditingFolderId(contextMenu.folder._id)
              setEditingName(contextMenu.folder.name)
              setContextMenu(null) 
            }}
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
            重命名
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            onClick={() => { handleDeleteFolder(contextMenu.folder._id); setContextMenu(null) }}
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
                  <span className="ml-2">{viewMaterial.folder || '默认'}</span>
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
