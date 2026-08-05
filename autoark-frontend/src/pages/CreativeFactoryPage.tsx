import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowClockwise,
  CaretDown,
  CheckCircle,
  FilmStrip,
  FolderOpen,
  ImageSquare,
  MagicWand,
  Plus,
  Robot,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import CreativeFactoryMaterialPicker from '../components/CreativeFactoryMaterialPicker'
import {
  createCreativeFactoryBatch,
  getCreativeFactoryBatch,
  getCreativeFactoryBatches,
  getCreativeFactoryTemplates,
  refreshCreativeFactoryJob,
  uploadCreativeFactoryStyleReference,
  type CreativeFactoryJob,
  type MaterialLibrarySource,
} from '../services/api'

const DEFAULT_TEMPLATE_KEY = 'clingai_dual_scene_reveal_v1'

const statusMeta: Record<string, { label: string; className: string }> = {
  awaiting_codex: { label: '等待 Codex', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  generating: { label: 'ai-host 生成中', className: 'bg-blue-50 text-blue-800 ring-blue-200' },
  codex_processing: { label: 'Codex 剪辑中', className: 'bg-violet-50 text-violet-800 ring-violet-200' },
  ready: { label: '已进素材库', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  failed: { label: '失败', className: 'bg-rose-50 text-rose-800 ring-rose-200' },
}

const StatusBadge = ({ status }: { status: string }) => {
  const meta = statusMeta[status] || { label: status, className: 'bg-zinc-100 text-zinc-700 ring-zinc-200' }
  return <span className={`rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${meta.className}`}>{meta.label}</span>
}

const outputMaterial = (job: CreativeFactoryJob) => (
  job.outputMaterialId && typeof job.outputMaterialId === 'object' ? job.outputMaterialId : null
)

export default function CreativeFactoryPage() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('ClingAI 素材批次')
  const [intent, setIntent] = useState('为 Meta 冷启动投放制作高停留率 9:16 素材，前三秒给出清晰钩子，完整替换原品牌元素。')
  const [selectedMaterials, setSelectedMaterials] = useState<MaterialLibrarySource[]>([])
  const [materialPickerOpen, setMaterialPickerOpen] = useState(false)
  const [selectedReference, setSelectedReference] = useState<MaterialLibrarySource | null>(null)
  const [referencePickerOpen, setReferencePickerOpen] = useState(false)
  const referenceUploadRef = useRef<HTMLInputElement>(null)
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE_KEY)
  const [outputMediaType, setOutputMediaType] = useState<'image' | 'video'>('video')
  const [variants, setVariants] = useState(2)
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [formError, setFormError] = useState('')

  const batchesQuery = useQuery({
    queryKey: ['creative-factory-batches'],
    queryFn: getCreativeFactoryBatches,
    refetchInterval: 15_000,
  })
  const batches = batchesQuery.data || []
  const templatesQuery = useQuery({
    queryKey: ['creative-factory-templates'],
    queryFn: getCreativeFactoryTemplates,
  })
  const templates = templatesQuery.data || []
  const selectedTemplate = templates.find((template) => template.key === templateKey)
  const usesFixedTemplate = Boolean(templateKey)

  useEffect(() => {
    if (!usesFixedTemplate) return
    setSelectedMaterials((current) => current.filter((material) => material.type === 'image'))
    setSelectedReference(null)
    setOutputMediaType('video')
    setVariants(1)
  }, [usesFixedTemplate])

  useEffect(() => {
    if (batches[0]?.batchId && !batches.some((batch) => batch.batchId === selectedBatchId)) {
      setSelectedBatchId(batches[0].batchId)
    }
  }, [batches, selectedBatchId])

  const batchQuery = useQuery({
    queryKey: ['creative-factory-batch', selectedBatchId],
    queryFn: () => getCreativeFactoryBatch(selectedBatchId),
    enabled: Boolean(selectedBatchId),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs || []
      return jobs.some((job) => !['ready', 'failed'].includes(job.status)) ? 8_000 : false
    },
  })

  const createMutation = useMutation({
    mutationFn: createCreativeFactoryBatch,
    onSuccess: (data) => {
      setSelectedBatchId(data.batchId)
      setSelectedMaterials([])
      setSelectedReference(null)
      setFormError('')
      queryClient.invalidateQueries({ queryKey: ['creative-factory-batches'] })
      queryClient.setQueryData(['creative-factory-batch', data.batchId], { batchId: data.batchId, jobs: data.jobs })
    },
    onError: (error: Error) => setFormError(error.message),
  })

  const refreshMutation = useMutation({
    mutationFn: refreshCreativeFactoryJob,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creative-factory-batches'] })
      queryClient.invalidateQueries({ queryKey: ['creative-factory-batch', selectedBatchId] })
    },
  })

  const referenceUploadMutation = useMutation({
    mutationFn: uploadCreativeFactoryStyleReference,
    onSuccess: (material) => {
      setSelectedReference(material)
      setOutputMediaType(material.type)
      setFormError('')
      if (referenceUploadRef.current) referenceUploadRef.current.value = ''
    },
    onError: (error: Error) => setFormError(error.message),
  })

  const assets = useMemo(
    () => selectedMaterials.map((material) => ({ materialId: material._id })),
    [selectedMaterials],
  )

  const submit = () => {
    if (assets.length === 0) {
      setFormError('请从 AutoArk 素材库选择至少一个来源素材')
      return
    }
    createMutation.mutate({
      title,
      intent,
      brandKey: 'clingai',
      outputMediaType: usesFixedTemplate ? 'video' : outputMediaType,
      aspectRatio: '9:16',
      variantsPerAsset: usesFixedTemplate ? 1 : variants,
      assets,
      styleReference: !usesFixedTemplate && selectedReference ? { materialId: selectedReference._id } : undefined,
      templateKey: templateKey || undefined,
    })
  }

  const selectedSummary = batches.find((batch) => batch.batchId === selectedBatchId)
  const jobs = batchQuery.data?.jobs || []

  return (
    <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">
            <MagicWand size={16} weight="fill" /> Creative Factory
          </div>
          <h1 className="text-3xl font-black tracking-tight text-zinc-950">ClingAI 素材生产线</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            选择人物图后，固定模板自动完成双场景生成、叠化剪辑与 ClingAI 品牌包装，成品回到素材库等待发布与归因。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600">
          <Robot size={17} className="text-[#0f766e]" /> AutoArk 模板队列 → ai-host → 素材归因
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="h-fit rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(24,24,27,0.55)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950">新建生产批次</h2>
              <p className="mt-1 text-xs text-zinc-500">从素材库文件夹多选，单批最多 20 个。</p>
            </div>
            <Plus size={20} className="text-zinc-400" />
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-zinc-700">
              生产模板
              <select value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10">
                {templatesQuery.isLoading && <option value={DEFAULT_TEMPLATE_KEY}>正在读取模板…</option>}
                {!templatesQuery.isLoading && templates.length === 0 && <option value={DEFAULT_TEMPLATE_KEY}>单图双场景转化视频</option>}
                {!templatesQuery.isLoading && templates.map((template) => <option key={template.key} value={template.key}>{template.name}</option>)}
                <option value="">自定义生产流程</option>
              </select>
            </label>
            {usesFixedTemplate && (
              <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-fuchsia-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white"><FilmStrip size={18} weight="fill" /></span>
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-zinc-950">{selectedTemplate?.name || '单图双场景转化视频'}</div>
                    <p className="mt-1 text-xs leading-5 text-zinc-600">{selectedTemplate?.description || '一张人物图自动生成 SFW/NSFW 双场景并剪成 5 秒 ClingAI 转化广告。'}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-1.5 text-[11px] font-semibold text-zinc-600">
                  {(selectedTemplate?.steps || ['SFW 私聊近景', 'SFW 泳池场景', 'NSFW 泳池场景', '双路图生视频', '固定叠化、ClingAI 文案与音轨']).map((step, index) => (
                    <div key={step} className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-rose-600 ring-1 ring-rose-200">{index + 1}</span>{step}</div>
                  ))}
                </div>
              </div>
            )}
            <label className="block text-xs font-bold text-zinc-700">
              批次名称
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10" />
            </label>
            <label className="block text-xs font-bold text-zinc-700">
              投放意图
              <textarea value={intent} onChange={(event) => setIntent(event.target.value)} rows={5} className="mt-1.5 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10" />
            </label>
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-zinc-700">来源素材</div>
                  <div className="mt-1 text-[11px] text-zinc-500">素材库是生产线唯一来源</div>
                </div>
                {selectedMaterials.length > 0 && <span className="text-xs font-extrabold text-[#0f766e]">已选 {selectedMaterials.length}/20</span>}
              </div>
              {selectedMaterials.length === 0 ? (
                <button type="button" onClick={() => setMaterialPickerOpen(true)} className="mt-2 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-7 text-center transition hover:border-[#0f766e] hover:bg-emerald-50/40 active:scale-[0.99]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#0f766e] shadow-sm ring-1 ring-zinc-200"><FolderOpen size={20} weight="fill" /></span>
                  <span className="mt-3 text-sm font-extrabold text-zinc-900">从素材库选择</span>
                  <span className="mt-1 text-xs text-zinc-500">{usesFixedTemplate ? '按文件夹浏览并选择人物图片' : '按文件夹浏览并多选图片或视频'}</span>
                </button>
              ) : (
                <div className="mt-2">
                  <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                    {selectedMaterials.map((material) => (
                      <div key={material._id} className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-2">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100">
                          {material.type === 'image' ? <img src={material.storage.url} alt="" className="h-full w-full object-cover" /> : <FilmStrip size={20} className="text-zinc-500" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-extrabold text-zinc-900">{material.name}</div>
                          <div className="mt-0.5 truncate text-[11px] font-semibold text-zinc-500">{material.folder || '默认'} · {material.type === 'image' ? '图片' : '视频'}</div>
                        </div>
                        <button type="button" onClick={() => setSelectedMaterials((current) => current.filter((item) => item._id !== material._id))} className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-800" aria-label={`移除 ${material.name}`}><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setMaterialPickerOpen(true)} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-extrabold text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.99]">
                    <FolderOpen size={16} />继续选择或更换
                  </button>
                </div>
              )}
            </div>

            {!usesFixedTemplate && <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-zinc-700">
                    素材示例 <span className="font-medium text-zinc-400">（可选）</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Codex 提取广告语言；示例类型自动决定成品类型
                  </div>
                </div>
                {selectedReference && (
                  <span className="rounded-md bg-cyan-50 px-2 py-1 text-[11px] font-extrabold text-cyan-800 ring-1 ring-inset ring-cyan-200">
                    {selectedReference.type === 'image' ? '图片样式' : '视频样式'}
                  </span>
                )}
              </div>
              {selectedReference ? (
                <div className="mt-2 overflow-hidden rounded-xl border border-cyan-200 bg-cyan-50/40">
                  <div className="flex items-center gap-3 p-2.5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-900">
                      {selectedReference.type === 'image' ? (
                        <img src={selectedReference.storage.url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <video src={selectedReference.storage.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-extrabold text-zinc-950">{selectedReference.name}</div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-600">
                        {selectedReference.type === 'image'
                          ? '图片来源直接处理；视频来源先截取有效画面'
                          : '图片来源先图生视频；视频来源直接按节奏剪辑'}
                      </div>
                    </div>
                    <button type="button" onClick={() => setSelectedReference(null)} className="rounded-md p-1.5 text-zinc-400 hover:bg-white hover:text-zinc-800" aria-label="移除素材示例">
                      <X size={15} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 border-t border-cyan-100">
                    <button type="button" onClick={() => setReferencePickerOpen(true)} className="flex items-center justify-center gap-1.5 border-r border-cyan-100 px-3 py-2 text-[11px] font-extrabold text-cyan-900 hover:bg-white/70">
                      <FolderOpen size={14} />从素材库更换
                    </button>
                    <button type="button" onClick={() => referenceUploadRef.current?.click()} className="flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-extrabold text-cyan-900 hover:bg-white/70">
                      <UploadSimple size={14} />上传新示例
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setReferencePickerOpen(true)} className="flex min-h-20 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 text-center transition hover:border-[#0f766e] hover:bg-emerald-50/40">
                    <FolderOpen size={19} className="text-[#0f766e]" weight="fill" />
                    <span className="mt-1.5 text-xs font-extrabold text-zinc-900">从素材库选择</span>
                  </button>
                  <button type="button" onClick={() => referenceUploadRef.current?.click()} disabled={referenceUploadMutation.isPending} className="flex min-h-20 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 text-center transition hover:border-[#0f766e] hover:bg-emerald-50/40 disabled:opacity-50">
                    <UploadSimple size={19} className="text-[#0f766e]" weight="bold" />
                    <span className="mt-1.5 text-xs font-extrabold text-zinc-900">
                      {referenceUploadMutation.isPending ? '正在上传…' : '上传图片或视频'}
                    </span>
                  </button>
                </div>
              )}
              <input
                ref={referenceUploadRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) referenceUploadMutation.mutate(file)
                }}
              />
            </div>}

            {!usesFixedTemplate && <div>
              <label className="text-xs font-bold text-zinc-700">
                目标成品
                <select value={selectedReference?.type || outputMediaType} disabled={Boolean(selectedReference)} onChange={(event) => setOutputMediaType(event.target.value as 'image' | 'video')} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm disabled:bg-zinc-100 disabled:text-zinc-600">
                  <option value="image">图片</option><option value="video">视频</option>
                </select>
                {selectedReference && <span className="mt-1 block text-[11px] font-medium text-zinc-500">已跟随素材示例自动锁定</span>}
              </label>
            </div>}
            {!usesFixedTemplate && <label className="block text-xs font-bold text-zinc-700">
              每个来源生成 {variants} 个变体
              <input type="range" min={1} max={4} value={variants} onChange={(event) => setVariants(Number(event.target.value))} className="mt-2 w-full accent-[#0f766e]" />
            </label>}

            {(formError || createMutation.error) && (
              <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800"><WarningCircle size={17} />{formError}</div>
            )}
            <button type="button" onClick={submit} disabled={createMutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-3 text-sm font-extrabold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
              <MagicWand size={18} weight="fill" /> {createMutation.isPending ? '正在创建任务…' : `送入生产线（${assets.length * (usesFixedTemplate ? 1 : variants) || 0} 个）`}
            </button>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(24,24,27,0.4)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="shrink-0">
                <label htmlFor="creative-factory-batch-history" className="text-sm font-extrabold text-zinc-950">
                  历史生产批次
                </label>
                <p id="creative-factory-batch-history-help" className="mt-1 text-xs text-zinc-500">
                  {batchesQuery.isLoading
                    ? '正在读取历史批次…'
                    : batches.length === 0
                      ? '还没有批次，从左侧创建第一批素材。'
                      : `共 ${batches.length} 个批次，默认显示最近一批。`}
                </p>
              </div>
              <div className="relative w-full sm:max-w-2xl">
                <select
                  id="creative-factory-batch-history"
                  aria-describedby="creative-factory-batch-history-help"
                  value={selectedBatchId}
                  disabled={batchesQuery.isLoading || batches.length === 0}
                  onChange={(event) => setSelectedBatchId(event.target.value)}
                  className="h-12 w-full appearance-none rounded-lg border border-zinc-300 bg-white pl-3.5 pr-11 text-sm font-bold text-zinc-900 outline-none transition hover:border-zinc-400 focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                >
                  {batchesQuery.isLoading && <option value="">正在读取历史批次…</option>}
                  {!batchesQuery.isLoading && batches.length === 0 && <option value="">还没有历史批次</option>}
                  {!batchesQuery.isLoading && batches.length > 0 && !selectedBatchId && <option value="">请选择历史批次</option>}
                  {batches.map((batch) => (
                    <option key={batch.batchId} value={batch.batchId}>
                      {batch.title} · {batch.ready}/{batch.total} 成品 · {batch.attributed} 已归因
                    </option>
                  ))}
                </select>
                <CaretDown aria-hidden="true" size={18} weight="bold" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              </div>
            </div>
          </div>

          {selectedSummary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['任务', selectedSummary.total],
                ['成品', selectedSummary.ready],
                ['失败', selectedSummary.failed],
                ['归因', selectedSummary.attributed],
              ].map(([label, value]) => <div key={label} className="rounded-lg border border-zinc-200 bg-white px-4 py-3"><div className="text-xs font-bold text-zinc-500">{label}</div><div className="mt-1 text-2xl font-black text-zinc-950">{value}</div></div>)}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div className="text-sm font-extrabold text-zinc-950">变体流水线</div>
              <button type="button" onClick={() => batchQuery.refetch()} className="rounded-md border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-50" aria-label="刷新"><ArrowClockwise size={16} /></button>
            </div>
            <div className="divide-y divide-zinc-100">
              {jobs.map((job) => {
                const material = outputMaterial(job)
                const previewUrl = material?.storage?.url || job.aiHost?.resultUrl || job.source.url
                return (
                  <article key={job._id} className="grid gap-4 p-4 md:grid-cols-[84px_minmax(0,1fr)_auto] md:items-center">
                    <div className="flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-lg bg-zinc-100">
                      {job.requestedOutput.mediaType === 'image' ? <img src={previewUrl} alt="" className="h-full w-full object-cover" /> : <FilmStrip size={28} className="text-zinc-400" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-extrabold text-zinc-950">{job.variantId}</span><StatusBadge status={job.status} />{job.attribution?.status === 'linked' && <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle size={15} weight="fill" />广告已归因</span>}</div>
                      <div className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-600">{job.analysis?.hook || job.intent}</div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-zinc-500"><span>{job.pipeline?.progressLabel || (job.workflow === 'extract_frame_then_edit' ? '视频截帧 + 样式处理' : job.workflow === 'edit_only' ? '直接样式处理' : 'ai-host 生成 + 剪辑')}</span><span>{job.templateKey ? `固定模板 v${job.templateVersion}` : (job.analysis?.featureKey || '待 Codex 选模板')}</span>{material?.metrics && <span>ROAS {Number(material.metrics.avgRoas || 0).toFixed(2)}</span>}</div>
                      {job.error && <div className="mt-2 text-xs font-semibold text-rose-700">{job.error}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {job.requestedOutput.mediaType === 'image' ? <ImageSquare size={19} className="text-zinc-400" /> : <FilmStrip size={19} className="text-zinc-400" />}
                      {job.status === 'generating' && <button type="button" onClick={() => refreshMutation.mutate(job._id)} disabled={refreshMutation.isPending} className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50">同步状态</button>}
                      {material?.storage?.url && <a href={material.storage.url} target="_blank" rel="noreferrer" className="rounded-md bg-zinc-950 px-3 py-2 text-xs font-bold text-white">查看成品</a>}
                    </div>
                  </article>
                )
              })}
              {!batchQuery.isLoading && selectedBatchId && jobs.length === 0 && <div className="p-10 text-center text-sm text-zinc-500">批次详情暂不可用。</div>}
            </div>
          </div>
        </section>
      </div>
      <CreativeFactoryMaterialPicker
        open={materialPickerOpen}
        selected={selectedMaterials}
        allowedMediaType={usesFixedTemplate ? 'image' : undefined}
        onClose={() => setMaterialPickerOpen(false)}
        onConfirm={(materials) => {
          setSelectedMaterials(materials)
          setMaterialPickerOpen(false)
          setFormError('')
        }}
      />
      <CreativeFactoryMaterialPicker
        open={referencePickerOpen}
        selected={selectedReference ? [selectedReference] : []}
        maxSelected={1}
        title="选择素材示例"
        description="只选一张图片或一个视频。Codex 会提取可迁移的广告结构与视觉语言，不复制示例中的品牌。"
        onClose={() => setReferencePickerOpen(false)}
        onConfirm={(materials) => {
          const reference = materials[0] || null
          setSelectedReference(reference)
          if (reference) setOutputMediaType(reference.type)
          setReferencePickerOpen(false)
          setFormError('')
        }}
      />
    </main>
  )
}
