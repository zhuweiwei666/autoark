import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowClockwise,
  CheckCircle,
  FilmStrip,
  ImageSquare,
  MagicWand,
  Plus,
  Robot,
  WarningCircle,
} from '@phosphor-icons/react'
import {
  createCreativeFactoryBatch,
  getCreativeFactoryBatch,
  getCreativeFactoryBatches,
  refreshCreativeFactoryJob,
  type CreativeFactoryJob,
} from '../services/api'

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
  const [sourceLines, setSourceLines] = useState('')
  const [sourceMediaType, setSourceMediaType] = useState<'image' | 'video'>('image')
  const [outputMediaType, setOutputMediaType] = useState<'image' | 'video'>('video')
  const [variants, setVariants] = useState(2)
  const [selectedBatchId, setSelectedBatchId] = useState('')
  const [formError, setFormError] = useState('')

  const batchesQuery = useQuery({ queryKey: ['creative-factory-batches'], queryFn: getCreativeFactoryBatches })
  const batches = batchesQuery.data || []

  useEffect(() => {
    if (!selectedBatchId && batches[0]?.batchId) setSelectedBatchId(batches[0].batchId)
  }, [batches, selectedBatchId])

  const batchQuery = useQuery({
    queryKey: ['creative-factory-batch', selectedBatchId],
    queryFn: () => getCreativeFactoryBatch(selectedBatchId),
    enabled: Boolean(selectedBatchId),
    refetchInterval: (query) => {
      const jobs = query.state.data?.jobs || []
      return jobs.some((job) => job.status === 'generating') ? 12_000 : false
    },
  })

  const createMutation = useMutation({
    mutationFn: createCreativeFactoryBatch,
    onSuccess: (data) => {
      setSelectedBatchId(data.batchId)
      setSourceLines('')
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

  const assets = useMemo(() => sourceLines
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((value) => (/^[a-f\d]{24}$/i.test(value)
      ? { materialId: value }
      : { sourceUrl: value, mediaType: sourceMediaType })), [sourceLines, sourceMediaType])

  const submit = () => {
    if (assets.length === 0) {
      setFormError('请粘贴至少一个 AutoArk 素材 ID 或 HTTPS 素材 URL')
      return
    }
    createMutation.mutate({
      title,
      intent,
      brandKey: 'clingai',
      outputMediaType,
      aspectRatio: '9:16',
      variantsPerAsset: variants,
      assets,
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
            AutoArk 收集投放意图与素材，Codex 拆解创意并完成去品牌剪辑，ai-host 复用现有图片/视频模板生成，成品自动回到素材库等待发布与归因。
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600">
          <Robot size={17} className="text-[#0f766e]" /> Codex 队列 → ai-host → 素材归因
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="h-fit rounded-xl border border-zinc-200 bg-white p-5 shadow-[0_18px_40px_-34px_rgba(24,24,27,0.55)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-extrabold text-zinc-950">新建生产批次</h2>
              <p className="mt-1 text-xs text-zinc-500">每行一个素材 ID 或公开 URL，最多 20 个。</p>
            </div>
            <Plus size={20} className="text-zinc-400" />
          </div>

          <div className="space-y-4">
            <label className="block text-xs font-bold text-zinc-700">
              批次名称
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10" />
            </label>
            <label className="block text-xs font-bold text-zinc-700">
              投放意图
              <textarea value={intent} onChange={(event) => setIntent(event.target.value)} rows={5} className="mt-1.5 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2.5 text-sm leading-6 outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10" />
            </label>
            <label className="block text-xs font-bold text-zinc-700">
              来源素材
              <textarea value={sourceLines} onChange={(event) => setSourceLines(event.target.value)} rows={6} placeholder={'AutoArk Material ID\n或 https://.../source.jpg'} className="mt-1.5 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2.5 font-mono text-xs leading-5 outline-none focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/10" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-bold text-zinc-700">
                URL 来源类型
                <select value={sourceMediaType} onChange={(event) => setSourceMediaType(event.target.value as 'image' | 'video')} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm">
                  <option value="image">图片</option><option value="video">视频</option>
                </select>
              </label>
              <label className="text-xs font-bold text-zinc-700">
                目标成品
                <select value={outputMediaType} onChange={(event) => setOutputMediaType(event.target.value as 'image' | 'video')} className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm">
                  <option value="image">图片</option><option value="video">视频</option>
                </select>
              </label>
            </div>
            <label className="block text-xs font-bold text-zinc-700">
              每个来源生成 {variants} 个变体
              <input type="range" min={1} max={4} value={variants} onChange={(event) => setVariants(Number(event.target.value))} className="mt-2 w-full accent-[#0f766e]" />
            </label>

            {(formError || createMutation.error) && (
              <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800"><WarningCircle size={17} />{formError}</div>
            )}
            <button type="button" onClick={submit} disabled={createMutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 py-3 text-sm font-extrabold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50">
              <MagicWand size={18} weight="fill" /> {createMutation.isPending ? '正在创建任务…' : `送入生产线（${assets.length * variants || 0} 个）`}
            </button>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {batches.map((batch) => (
              <button key={batch.batchId} type="button" onClick={() => setSelectedBatchId(batch.batchId)} className={`min-w-[220px] rounded-lg border p-3 text-left ${selectedBatchId === batch.batchId ? 'border-zinc-900 bg-zinc-950 text-white' : 'border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400'}`}>
                <div className="truncate text-sm font-extrabold">{batch.title}</div>
                <div className={`mt-2 flex gap-3 text-xs ${selectedBatchId === batch.batchId ? 'text-zinc-300' : 'text-zinc-500'}`}><span>{batch.ready}/{batch.total} 成品</span><span>{batch.attributed} 已归因</span></div>
              </button>
            ))}
            {!batchesQuery.isLoading && batches.length === 0 && <div className="w-full rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500">还没有批次，从左侧创建第一批素材。</div>}
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
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-zinc-500"><span>{job.workflow === 'edit_only' ? '原片剪辑' : 'ai-host 生成 + 剪辑'}</span><span>{job.analysis?.featureKey || '待 Codex 选模板'}</span>{material?.metrics && <span>ROAS {Number(material.metrics.avgRoas || 0).toFixed(2)}</span>}</div>
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
    </main>
  )
}
