import { FormEvent, useEffect, useState } from 'react'
import {
  createMaterialVariant,
  createMaterialVariantIdempotencyKey,
  getMaterialVariant,
  getMaterialVariantConfigStatus,
  isMaterialVariantTerminal,
  type MaterialVariantJob,
} from '../services/materialVariants'

interface VariantSourceMaterial {
  _id: string
  name: string
  file?: {
    width?: number
    height?: number
  }
}

interface MaterialVariantPanelProps {
  material: VariantSourceMaterial
  onCompleted?: (outputMaterialId?: string) => void
}

const statusText = (job: MaterialVariantJob): string => {
  if (job.status === 'submitting') return '正在提交'
  if (job.status === 'submission_unknown') return '提交结果待确认'
  if (job.status === 'queued') return '已排队'
  if (job.status === 'processing') return '生成中'
  if (job.status === 'completed') return '已生成，等待人工审核'
  if (job.status === 'cancelled') return '已取消'
  return '生成失败'
}

const inferredAspectRatio = (material: VariantSourceMaterial): string => {
  const width = Number(material.file?.width)
  const height = Number(material.file?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '9:16'
  }
  const ratio = width / height
  const candidates = [
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
  ] as const
  return candidates.reduce((best, current) => (
    Math.abs(current[1] - ratio) < Math.abs(best[1] - ratio) ? current : best
  ))[0]
}

export default function MaterialVariantPanel({
  material,
  onCompleted,
}: MaterialVariantPanelProps) {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [referenceImageUrl, setReferenceImageUrl] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(3)
  const [strength, setStrength] = useState(0.85)
  const [preserveAudio, setPreserveAudio] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState<MaterialVariantJob | null>(null)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [configurationIssue, setConfigurationIssue] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    getMaterialVariantConfigStatus(controller.signal)
      .then((status) => {
        setConfigured(status.configured)
        if (!status.configured) {
          setConfigurationIssue(
            [...status.missing, ...status.invalid].join('、') || '服务配置不完整',
          )
        }
      })
      .catch((requestError: any) => {
        if (requestError?.name !== 'AbortError') {
          setConfigured(false)
          setConfigurationIssue(requestError?.message || '无法读取服务配置')
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!job || isMaterialVariantTerminal(job.status)) return
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const poll = async () => {
      try {
        const latest = await getMaterialVariant(job._id, controller.signal)
        if (stopped) return
        setJob(latest)
        if (latest.status === 'completed') {
          onCompleted?.(latest.outputMaterialId)
          return
        }
        if (!isMaterialVariantTerminal(latest.status)) {
          timeoutId = setTimeout(poll, 5000)
        }
      } catch (requestError: any) {
        if (!stopped && requestError?.name !== 'AbortError') {
          setError(requestError?.message || '查询生成状态失败')
          timeoutId = setTimeout(poll, 8000)
        }
      }
    }

    timeoutId = setTimeout(poll, 3000)
    return () => {
      stopped = true
      controller.abort()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [job?._id])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (prompt.trim().length < 3 || submitting || configured !== true) return

    setSubmitting(true)
    setError('')
    try {
      const created = await createMaterialVariant(
        {
          parentMaterialId: material._id,
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          referenceImageUrl: referenceImageUrl.trim() || undefined,
          durationSeconds,
          strength,
          preserveAudio,
          aspectRatio: inferredAspectRatio(material),
        },
        createMaterialVariantIdempotencyKey(),
      )
      setJob(created)
      if (created.status === 'completed') onCompleted?.(created.outputMaterialId)
    } catch (requestError: any) {
      setError(requestError?.message || '提交 AI 视频变体失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium text-indigo-950">AI 视频变体</h4>
          <p className="mt-1 text-xs leading-5 text-indigo-700">
            基于原视频前 2–5 秒生成新画面；结果只进入素材库，需人工审核后再投放。
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] text-indigo-700">
          VACE · 低优先级队列
        </span>
      </div>

      {configured === false ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          视频变体服务尚未就绪：{configurationIssue}
        </div>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">你希望改变什么</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="例如：保留人物和核心卖点，改成暖色夜景，镜头运动更有冲击力，避免文字和水印。"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">生成时长</span>
              <select
                value={durationSeconds}
                onChange={(event) => setDurationSeconds(Number(event.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {[2, 3, 4, 5].map(seconds => (
                  <option key={seconds} value={seconds}>{seconds} 秒</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="flex justify-between text-xs font-medium text-slate-700">
                <span>变化强度</span>
                <span>{Math.round(strength * 100)}%</span>
              </span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
                className="mt-3 w-full accent-indigo-600"
              />
            </label>
          </div>

          <details className="rounded-lg border border-indigo-100 bg-white/80 p-3">
            <summary className="cursor-pointer text-xs font-medium text-indigo-800">
              高级参数
            </summary>
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="text-xs text-slate-600">参考图片 URL（可选）</span>
                <input
                  type="url"
                  value={referenceImageUrl}
                  onChange={(event) => setReferenceImageUrl(event.target.value)}
                  placeholder="https://..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-600">负向提示词（可选）</span>
                <textarea
                  value={negativePrompt}
                  onChange={(event) => setNegativePrompt(event.target.value)}
                  maxLength={2000}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={preserveAudio}
                  onChange={(event) => setPreserveAudio(event.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                保留原视频音轨
              </label>
            </div>
          </details>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {job && (
            <div className={`rounded-lg border p-3 text-xs ${
              job.status === 'completed'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : job.status === 'failed' || job.status === 'cancelled'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}>
              <div className="font-medium">{statusText(job)}</div>
              {job.warning && <div className="mt-1">{job.warning}</div>}
              {job.error?.message && <div className="mt-1">{job.error.message}</div>}
              {job.generationJobId && (
                <div className="mt-1 break-all text-[11px] opacity-75">
                  生成任务：{job.generationJobId}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-4 text-slate-500">
              请勿用视觉扰动、隐藏帧等方式规避平台审核；变体仍需符合 Meta 政策。
            </p>
            <button
              type="submit"
              disabled={
                submitting
                || configured !== true
                || prompt.trim().length < 3
                || Boolean(job && !isMaterialVariantTerminal(job.status))
              }
              className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? '提交中…' : '生成变体'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
