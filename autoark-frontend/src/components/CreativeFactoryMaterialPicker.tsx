import { FormEvent, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  Check,
  FilmStrip,
  Folder,
  FolderOpen,
  ImageSquare,
  MagnifyingGlass,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import {
  getMaterialLibraryFolders,
  getMaterialLibrarySources,
  type MaterialLibrarySource,
} from '../services/api'
import {
  buildMaterialQuery,
  loadMaterialSmartGroups,
  toggleSmartGroupExpansion,
  type MaterialSelection,
  type MaterialSmartGroupNode,
} from '../services/materialSmartGroups'

const MAX_SELECTED_MATERIALS = 20

function MaterialPreview({ material }: { material: MaterialLibrarySource }) {
  if (material.type === 'image') {
    return <img src={material.storage.url} alt="" className="h-full w-full object-cover" loading="lazy" />
  }

  return (
    <div className="relative h-full w-full bg-zinc-900">
      <video
        src={material.storage.url}
        muted
        playsInline
        preload="metadata"
        aria-label={`${material.name} 视频预览`}
        onLoadedMetadata={(event) => {
          event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration || 0.1)
        }}
        className="h-full w-full object-cover"
      />
      <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-zinc-950/75 p-1.5 text-white">
        <FilmStrip size={15} weight="fill" />
      </span>
    </div>
  )
}

function MaterialGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="aspect-[4/3] animate-pulse bg-zinc-100" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-100" />
            <div className="h-2.5 w-2/5 animate-pulse rounded bg-zinc-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function CreativeFactoryMaterialPicker({
  open,
  selected,
  onClose,
  onConfirm,
  title = '选择来源素材',
  description = '按 AutoArk 素材库现有分组或文件夹定位，再多选要进入 ClingAI 生产线的图片或视频。',
  maxSelected = MAX_SELECTED_MATERIALS,
  allowedMediaType,
}: {
  open: boolean
  selected: MaterialLibrarySource[]
  onClose: () => void
  onConfirm: (materials: MaterialLibrarySource[]) => void
  title?: string
  description?: string
  maxSelected?: number
  allowedMediaType?: 'image' | 'video'
}) {
  const [draftSelection, setDraftSelection] = useState<MaterialLibrarySource[]>(selected)
  const [scope, setScope] = useState<MaterialSelection>({ kind: 'all' })
  const [expandedSmartGroups, setExpandedSmartGroups] = useState<Set<string>>(
    () => new Set(['facebook-root:facebook', 'external-root:external']),
  )
  const [type, setType] = useState<'' | 'image' | 'video'>(allowedMediaType || '')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectionError, setSelectionError] = useState('')

  useEffect(() => {
    if (!open) return
    setDraftSelection(selected)
    setType(allowedMediaType || '')
    setSelectionError('')
  }, [allowedMediaType, open, selected])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  const foldersQuery = useQuery({
    queryKey: ['material-library-folders'],
    queryFn: getMaterialLibraryFolders,
    enabled: open,
  })

  const smartGroupsQuery = useQuery({
    queryKey: ['material-library-smart-groups'],
    queryFn: ({ signal }) => loadMaterialSmartGroups(signal),
    enabled: open,
  })

  const materialsQuery = useQuery({
    queryKey: ['creative-factory-materials', scope, type, search, page],
    queryFn: ({ signal }) => getMaterialLibrarySources(buildMaterialQuery({
      selection: scope,
      page,
      pageSize: 24,
      type,
      search,
    }), signal),
    enabled: open,
  })

  const selectedIds = useMemo(
    () => new Set(draftSelection.map((material) => material._id)),
    [draftSelection],
  )

  if (!open) return null

  const chooseFolder = (nextFolder: string) => {
    setScope(nextFolder ? { kind: 'folder', path: nextFolder } : { kind: 'all' })
    setPage(1)
  }

  const chooseSmartGroup = (group: MaterialSmartGroupNode) => {
    if (group.type !== 'facebook-account' && group.type !== 'external-package') return
    setScope({
      kind: 'smart',
      type: group.type,
      key: group.key,
      label: group.label,
    })
    setPage(1)
  }

  const chooseType = (nextType: '' | 'image' | 'video') => {
    if (allowedMediaType) return
    setType(nextType)
    setPage(1)
  }

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setSearch(searchDraft.trim())
    setPage(1)
  }

  const toggleMaterial = (material: MaterialLibrarySource) => {
    setSelectionError('')
    setDraftSelection((current) => {
      if (current.some((item) => item._id === material._id)) {
        return current.filter((item) => item._id !== material._id)
      }
      if (current.length >= maxSelected) {
        setSelectionError(
          maxSelected === 1
            ? '素材示例只能选择 1 个'
            : `每个生产批次最多选择 ${maxSelected} 个来源素材`,
        )
        return current
      }
      return [...current, material]
    })
  }

  const materials = materialsQuery.data?.list || []
  const activeScopeName = scope.kind === 'smart'
    ? scope.label
    : scope.kind === 'folder'
      ? scope.path
      : '全部素材'

  const smartGroupStatusLabel = (group: MaterialSmartGroupNode) => {
    if (group.status === 'disabled') return '已停用'
    if (group.status === 'unavailable') return '不可用'
    if (group.status === 'paused' || group.paused) return '已暂停'
    return null
  }

  const renderSmartGroupNode = (group: MaterialSmartGroupNode, depth = 0) => {
    const selectable = group.type === 'facebook-account' || group.type === 'external-package'
    const isExpandable = Boolean(group.children?.length)
    const nodeId = `${group.type}:${group.key}`
    const isExpanded = expandedSmartGroups.has(nodeId)
    const isSelected = scope.kind === 'smart' &&
      scope.type === group.type &&
      scope.key === group.key
    const label = group.type === 'facebook-root'
      ? 'Facebook'
      : group.type === 'external-root'
        ? '外部优质素材'
        : group.label
    const statusLabel = smartGroupStatusLabel(group)

    return (
      <div key={nodeId}>
        <button
          type="button"
          disabled={!selectable && !isExpandable}
          aria-expanded={isExpandable ? isExpanded : undefined}
          onClick={() => {
            if (isExpandable) {
              setExpandedSmartGroups((current) => toggleSmartGroupExpansion(current, nodeId))
              return
            }
            chooseSmartGroup(group)
          }}
          className={`flex w-full items-center gap-1.5 rounded-lg py-2 pr-2 text-left text-sm transition ${
            isSelected
              ? 'bg-[#0f766e] font-bold text-white'
              : selectable || isExpandable
                ? 'text-zinc-700 hover:bg-zinc-200/70'
                : 'cursor-default text-zinc-500'
          }`}
          style={{ paddingLeft: `${8 + Math.min(depth, 4) * 12}px` }}
          title={label}
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            {isExpandable && (
              <CaretRight
                size={13}
                weight="bold"
                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            )}
          </span>
          <span
            aria-hidden="true"
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-black ${
              isSelected
                ? 'bg-white/20 text-white'
                : group.type.startsWith('external')
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-blue-100 text-blue-700'
            }`}
          >
            {group.type.startsWith('external')
              ? '◆'
              : group.type === 'facebook-optimizer'
                ? '人'
                : 'f'}
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {statusLabel && (
            <span className={`rounded px-1 py-0.5 text-[9px] ${isSelected ? 'bg-white/15 text-white' : 'bg-zinc-200 text-zinc-500'}`}>
              {statusLabel}
            </span>
          )}
          <span className={isSelected ? 'text-emerald-100' : 'text-zinc-500'}>{group.count}</span>
        </button>
        {isExpanded && group.children?.map((child) => renderSmartGroupNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="creative-factory-material-picker-title"
        className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-[0_28px_80px_-28px_rgba(24,24,27,0.55)]"
      >
        <header className="flex items-start justify-between gap-5 border-b border-zinc-200 px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[#0f766e]">
              <FolderOpen size={16} weight="fill" /> AutoArk 素材库
            </div>
            <h2 id="creative-factory-material-picker-title" className="mt-1 text-xl font-black tracking-tight text-zinc-950">
              {title}
            </h2>
            <p className="mt-1 text-sm text-zinc-500">{description}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 active:scale-[0.98]" aria-label="关闭素材选择器">
            <X size={20} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-zinc-200 bg-zinc-50/80 p-3 md:border-b-0 md:border-r">
            <div className="mb-2 px-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-zinc-500">素材范围</div>
            <button
              type="button"
              onClick={() => chooseFolder('')}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-bold transition ${scope.kind === 'all' ? 'bg-zinc-950 text-white' : 'text-zinc-700 hover:bg-zinc-200/70'}`}
            >
              <span className="flex items-center gap-2"><FolderOpen size={17} />全部素材</span>
              <span className={scope.kind === 'all' ? 'text-zinc-300' : 'text-zinc-500'}>{foldersQuery.data?.totalCount || 0}</span>
            </button>

            <div className="mt-3 border-t border-zinc-200 pt-3">
              <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-zinc-500">
                <span>智能分组</span>
                <span className="normal-case tracking-normal text-zinc-400">与素材库同步</span>
              </div>
              {smartGroupsQuery.isLoading ? (
                <div className="space-y-2 px-2 py-2" aria-label="正在加载素材分组">
                  {Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-8 animate-pulse rounded-lg bg-zinc-200/70" />)}
                </div>
              ) : smartGroupsQuery.isError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                  素材分组加载失败
                  <button type="button" onClick={() => smartGroupsQuery.refetch()} className="mt-2 block font-extrabold underline">重新加载</button>
                </div>
              ) : (
                <div className="space-y-0.5">{(smartGroupsQuery.data || []).map((group) => renderSmartGroupNode(group))}</div>
              )}
            </div>

            <div className="mt-3 border-t border-zinc-200 pt-3">
              <div className="mb-1 px-2 text-[11px] font-extrabold uppercase tracking-[0.1em] text-zinc-500">自建文件夹</div>
              {foldersQuery.isLoading ? (
                <div className="space-y-2 px-2 py-2" aria-label="正在加载文件夹">
                  {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-8 animate-pulse rounded-lg bg-zinc-200/70" />)}
                </div>
              ) : foldersQuery.isError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                  文件夹加载失败
                  <button type="button" onClick={() => foldersQuery.refetch()} className="mt-2 block font-extrabold underline">重新加载</button>
                </div>
              ) : (foldersQuery.data?.folders || []).length === 0 ? (
                <div className="px-2 py-2 text-xs text-zinc-400">暂无自建文件夹</div>
              ) : (
                <div className="space-y-1">
                  {(foldersQuery.data?.folders || []).map((item) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() => chooseFolder(item.path)}
                      className={`flex w-full items-center justify-between rounded-lg py-2.5 pr-3 text-left text-sm transition ${scope.kind === 'folder' && scope.path === item.path ? 'bg-[#0f766e] font-bold text-white' : 'text-zinc-700 hover:bg-zinc-200/70'}`}
                      style={{ paddingLeft: `${12 + Math.min(item.level || 0, 4) * 12}px` }}
                      title={item.path}
                    >
                      <span className="flex min-w-0 items-center gap-2"><Folder size={16} weight={scope.kind === 'folder' && scope.path === item.path ? 'fill' : 'regular'} /><span className="truncate">{item.name}</span></span>
                      <span className={scope.kind === 'folder' && scope.path === item.path ? 'text-emerald-100' : 'text-zinc-500'}>{item.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-zinc-200 px-4 py-3 sm:px-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-1 rounded-lg bg-zinc-100 p-1">
                  {([
                    ['', '全部'],
                    ['image', '图片'],
                    ['video', '视频'],
                  ] as const).filter(([value]) => !allowedMediaType || value === allowedMediaType).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => chooseType(value)} className={`rounded-md px-3 py-1.5 text-xs font-bold transition active:scale-[0.98] ${type === value ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-900'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <form onSubmit={submitSearch} className="flex w-full gap-2 lg:max-w-sm">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">搜索素材</span>
                    <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索素材名称" className="w-full rounded-lg border border-zinc-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10" />
                  </label>
                  <button type="submit" className="rounded-lg border border-zinc-300 px-3 text-xs font-extrabold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]">搜索</button>
                </form>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span className="truncate">{activeScopeName} · {materialsQuery.data?.total || 0} 个素材</span>
                <span className="shrink-0 font-bold text-[#0f766e]">已选 {draftSelection.length}/{maxSelected}</span>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {selectionError && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900">
                  <WarningCircle size={17} />{selectionError}
                </div>
              )}
              {materialsQuery.isLoading ? (
                <MaterialGridSkeleton />
              ) : materialsQuery.isError ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-rose-200 bg-rose-50/50 px-6 text-center">
                  <WarningCircle size={28} className="text-rose-600" />
                  <div className="mt-3 text-sm font-extrabold text-zinc-900">素材加载失败</div>
                  <div className="mt-1 text-xs text-zinc-500">请检查网络后重试，已选素材不会丢失。</div>
                  <button type="button" onClick={() => materialsQuery.refetch()} className="mt-4 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-bold text-white">重新加载</button>
                </div>
              ) : materials.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-6 text-center">
                  <ImageSquare size={30} className="text-zinc-400" />
                  <div className="mt-3 text-sm font-extrabold text-zinc-900">这个范围内没有素材</div>
                  <div className="mt-1 text-xs text-zinc-500">切换素材分组、文件夹或清除搜索条件后再试。</div>
                  {(search || type) && <button type="button" onClick={() => { setSearch(''); setSearchDraft(''); setType(''); setPage(1) }} className="mt-4 text-xs font-extrabold text-[#0f766e] underline">清除筛选</button>}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {materials.map((material) => {
                    const isSelected = selectedIds.has(material._id)
                    return (
                      <button
                        key={material._id}
                        type="button"
                        onClick={() => toggleMaterial(material)}
                        aria-pressed={isSelected}
                        className={`group overflow-hidden rounded-xl border bg-white text-left transition active:scale-[0.98] ${isSelected ? 'border-[#0f766e] ring-2 ring-[#0f766e]/15' : 'border-zinc-200 hover:-translate-y-0.5 hover:border-zinc-400'}`}
                      >
                        <div className="relative aspect-[4/3] overflow-hidden bg-zinc-100">
                          <MaterialPreview material={material} />
                          <span className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition ${isSelected ? 'border-[#0f766e] bg-[#0f766e] text-white' : 'border-white/80 bg-white/85 text-transparent shadow-sm'}`}>
                            <Check size={14} weight="bold" />
                          </span>
                        </div>
                        <div className="p-3">
                          <div className="truncate text-xs font-extrabold text-zinc-900" title={material.name}>{material.name}</div>
                          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-500">
                            <span className="flex items-center gap-1">{material.type === 'image' ? <ImageSquare size={13} /> : <FilmStrip size={13} />}{material.type === 'image' ? '图片' : '视频'}</span>
                            <span className="max-w-[60%] truncate" title={material.folder}>{material.folder || '默认'}</span>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <footer className="flex flex-col gap-3 border-t border-zinc-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || materialsQuery.isLoading} className="rounded-lg border border-zinc-300 p-2 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label="上一页"><ArrowLeft size={17} /></button>
                <span className="min-w-20 text-center text-xs font-bold text-zinc-600">{page} / {materialsQuery.data?.totalPages || 1}</span>
                <button type="button" onClick={() => setPage((current) => Math.min(materialsQuery.data?.totalPages || current, current + 1))} disabled={page >= (materialsQuery.data?.totalPages || 1) || materialsQuery.isLoading} className="rounded-lg border border-zinc-300 p-2 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35" aria-label="下一页"><ArrowRight size={17} /></button>
              </div>
              <div className="flex gap-2 sm:justify-end">
                <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] sm:flex-none">取消</button>
                <button type="button" onClick={() => onConfirm(draftSelection)} disabled={draftSelection.length === 0} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-zinc-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">
                  <Check size={17} weight="bold" />确认选择（{draftSelection.length}）
                </button>
              </div>
            </footer>
          </div>
        </div>
      </section>
    </div>
  )
}
