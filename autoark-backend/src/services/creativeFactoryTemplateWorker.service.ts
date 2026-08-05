import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import sharp from 'sharp'
import CreativeFactoryJob from '../models/CreativeFactoryJob'
import Material from '../models/Material'
import {
  DUAL_SCENE_TEMPLATE_KEY,
  getCreativeFactoryTemplate,
} from '../config/creativeFactoryTemplates.config'
import {
  createAiHostGeneration,
  getAiHostGenerationStatus,
  type AiHostGeneration,
} from './aiHostCreativeFactory.service'
import { getCreativeFactoryStorageRoot } from './creativeFactory.service'
import { uploadBufferToR2 } from './r2Storage.service'
import logger from '../utils/logger'

const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024
const LEASE_MS = 20 * 60_000
const MAX_TRANSIENT_ATTEMPTS = 3
const RETRY_BASE_MS = 30_000

type StepState = {
  status?: 'pending' | 'completed' | 'failed'
  featureKey?: string
  externalVariantId?: string
  generationId?: string
  genJobId?: string
  resultUrl?: string
  error?: string
  updatedAt?: Date
}

type GenerationSpec = {
  key: string
  label: string
  featureKey: 'qwen_edit' | 'creative_factory_video'
  sourceUrl: string
  templateId: string
  creativeDirection?: string
  imageOperation?: 'sfw' | 'undress'
}

const safeRemoteUrl = (value: unknown) => {
  const parsed = new URL(String(value || ''))
  if (parsed.protocol !== 'https:') throw new Error('流水线素材必须使用 HTTPS')
  return parsed.toString()
}

async function downloadToFile(url: string, target: string) {
  const response = await fetch(safeRemoteUrl(url), {
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok || !response.body) {
    throw new Error(`素材下载失败 (${response.status})`)
  }
  const declaredSize = Number(response.headers.get('content-length'))
  if (declaredSize > MAX_DOWNLOAD_BYTES) throw new Error('流水线素材超过 200MB')
  let received = 0
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length
      callback(
        received > MAX_DOWNLOAD_BYTES
          ? new Error('流水线素材超过 200MB')
          : null,
        chunk,
      )
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as any),
    limiter,
    createWriteStream(target),
  )
}

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const stderr: Buffer[] = []
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk)
      if (stderr.length > 80) stderr.shift()
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) return resolve()
      reject(
        new Error(
          `${command} exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-1200)}`,
        ),
      )
    })
  })
}

async function createBrandOverlay(
  target: string,
  width: number,
  height: number,
  title: string,
) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="transparent"/>
    <rect x="52" y="218" width="850" height="104" rx="52" fill="#e985b2" fill-opacity="0.94"/>
    <text x="82" y="286" fill="#ffffff" font-family="DejaVu Sans,Arial,sans-serif" font-size="46" font-style="italic" font-weight="700">${title}</text>
    <rect x="884" y="58" width="136" height="52" rx="26" fill="#fb174b"/>
    <circle cx="909" cy="84" r="7" fill="#ffffff"/>
    <text x="925" y="94" fill="#ffffff" font-family="DejaVu Sans,Arial,sans-serif" font-size="28" font-weight="700">LIVE</text>
  </svg>`
  await sharp(Buffer.from(svg)).png().toFile(target)
}

export async function composeDualSceneVideo(params: {
  sfwVideoUrl: string
  nsfwVideoUrl: string
  audioUrl: string
  outputPath: string
}) {
  const template = getCreativeFactoryTemplate(DUAL_SCENE_TEMPLATE_KEY)
  if (!template) throw new Error('双场景模板配置不存在')
  const workdir = path.dirname(params.outputPath)
  const sfwPath = path.join(workdir, 'sfw.mp4')
  const nsfwPath = path.join(workdir, 'nsfw.mp4')
  const audioPath = path.join(workdir, 'audio.m4a')
  const overlayPath = path.join(workdir, 'brand.png')
  await Promise.all([
    downloadToFile(params.sfwVideoUrl, sfwPath),
    downloadToFile(params.nsfwVideoUrl, nsfwPath),
    downloadToFile(params.audioUrl, audioPath),
    createBrandOverlay(
      overlayPath,
      template.composition.width,
      template.composition.height,
      template.composition.title,
    ),
  ])

  return composeDualSceneFiles({
    sfwPath,
    nsfwPath,
    audioPath,
    overlayPath,
    outputPath: params.outputPath,
  })
}

export async function composeDualSceneFiles(params: {
  sfwPath: string
  nsfwPath: string
  audioPath: string
  overlayPath?: string
  outputPath: string
}) {
  const template = getCreativeFactoryTemplate(DUAL_SCENE_TEMPLATE_KEY)
  if (!template) throw new Error('双场景模板配置不存在')
  const c = template.composition
  const overlayPath =
    params.overlayPath ||
    path.join(path.dirname(params.outputPath), 'brand.png')
  if (!params.overlayPath) {
    await createBrandOverlay(overlayPath, c.width, c.height, c.title)
  }
  const filter = buildDualSceneFilter(c)
  await runProcess('nice', [
    '-n',
    '10',
    'ffmpeg',
    '-y',
    '-i',
    params.sfwPath,
    '-i',
    params.nsfwPath,
    '-loop',
    '1',
    '-i',
    overlayPath,
    '-stream_loop',
    '-1',
    '-i',
    params.audioPath,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-t',
    String(c.durationSeconds),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(c.fps),
    '-threads',
    '1',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    params.outputPath,
  ])
  return {
    width: c.width,
    height: c.height,
    duration: c.durationSeconds,
    fps: c.fps,
  }
}

export function buildDualSceneFilter(c: {
  width: number
  height: number
  fps: number
  durationSeconds: number
  revealStartSeconds: number
  revealEndSeconds: number
  revealOpacity: number
}) {
  const baseOpacity = Number((1 - c.revealOpacity).toFixed(4))
  const revealLastFrame = Number((c.revealEndSeconds - 0.000001).toFixed(6))
  return [
    `[0:v]scale=${c.width}:${c.height}:force_original_aspect_ratio=increase,crop=${c.width}:${c.height},fps=${c.fps},trim=duration=${c.durationSeconds},setpts=PTS-STARTPTS[sfw]`,
    `[1:v]scale=${c.width}:${c.height}:force_original_aspect_ratio=increase,crop=${c.width}:${c.height},fps=${c.fps},trim=duration=${c.durationSeconds},setpts=PTS-STARTPTS[nsfw]`,
    `[sfw][nsfw]blend=all_expr='if(between(T,${c.revealStartSeconds},${revealLastFrame}),A*${baseOpacity}+B*${c.revealOpacity},A)'[mixed]`,
    '[mixed][2:v]overlay=0:0:format=auto[outv]',
    `[3:a]atrim=duration=${c.durationSeconds},asetpts=PTS-STARTPTS[outa]`,
  ].join(';')
}

const stepsFor = (job: any): Record<string, StepState> =>
  job.pipeline?.steps && typeof job.pipeline.steps === 'object'
    ? job.pipeline.steps
    : {}

async function persistStep(
  job: any,
  key: string,
  state: StepState,
  label: string,
) {
  const steps = stepsFor(job)
  steps[key] = { ...steps[key], ...state, updatedAt: new Date() }
  job.pipeline.steps = steps
  job.pipeline.currentStep = key
  job.pipeline.progressLabel = label
  job.pipeline.nextAttemptAt = new Date(Date.now() + 15_000)
  job.pipeline.lastError = undefined
  job.pipeline.attempts = 0
  job.markModified('pipeline.steps')
  await job.save()
}

async function runGenerationStep(job: any, spec: GenerationSpec) {
  const existing = stepsFor(job)[spec.key]
  const externalVariantId = `${job.variantId}-${spec.key}`
  let result: AiHostGeneration
  if (existing?.status === 'pending') {
    result = await getAiHostGenerationStatus({
      externalBatchId: job.batchId,
      externalVariantId,
      featureKey: spec.featureKey,
    })
  } else {
    result = await createAiHostGeneration({
      externalBatchId: job.batchId,
      externalVariantId,
      sourceImageUrl: safeRemoteUrl(spec.sourceUrl),
      featureKey: spec.featureKey,
      templateId: spec.templateId,
      creativeDirection: spec.creativeDirection,
      imageOperation: spec.imageOperation,
    })
  }

  const state: StepState = {
    status:
      result.status === 'succeeded'
        ? 'completed'
        : result.status === 'failed'
          ? 'failed'
          : 'pending',
    featureKey: spec.featureKey,
    externalVariantId,
    generationId: result.generationId,
    genJobId: result.genJobId || undefined,
    resultUrl: result.resultUrl || undefined,
    error: result.error || undefined,
  }
  job.aiHost = {
    status: result.status,
    generationId: result.generationId,
    presetToken: result.presetToken,
    genJobId: result.genJobId || undefined,
    resultUrl: result.resultUrl || undefined,
    error: result.error || undefined,
    updatedAt: new Date(),
  }
  if (state.status === 'completed' && !state.resultUrl) {
    throw new Error(`${spec.label}生成成功但没有结果 URL`)
  }
  if (state.status === 'failed') {
    throw new Error(state.error || `${spec.label}生成失败`)
  }
  await persistStep(job, spec.key, state, spec.label)
}

async function finishJob(job: any, outputPath: string, meta: any) {
  const buffer = await fs.readFile(outputPath)
  const root = getCreativeFactoryStorageRoot(job)
  const upload = await uploadBufferToR2({
    buffer,
    originalName: `${job.title}-${job.variantId}.mp4`,
    mimeType: 'video/mp4',
    folder: `${root}/creative-factory`,
    key: `${root}/creative-factory/${job._id}.mp4`,
  })
  if (!upload.success || !upload.key || !upload.url) {
    throw new Error(upload.error || '成品上传 R2 失败')
  }
  let material: any = await Material.findOne({
    ...(job.organizationId
      ? { organizationId: job.organizationId }
      : { createdBy: job.createdBy }),
    'source.platform': 'creative_factory',
    'source.externalCreativeId': job._id.toString(),
  })
  if (!material)
    material = await Material.create({
      organizationId: job.organizationId || undefined,
      name: `${job.title}-${job.variantId}`,
      type: 'video',
      status: 'ready',
      storage: { provider: 'r2', key: upload.key, url: upload.url },
      file: {
        originalName: path.basename(outputPath),
        mimeType: 'video/mp4',
        size: buffer.byteLength,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
      },
      source: {
        type: 'import',
        platform: 'creative_factory',
        externalCreativeId: job._id.toString(),
        assetKind: 'video',
        isOriginal: false,
        importedAt: new Date(),
        importedBy: 'creative-factory-template-worker',
      },
      tags: [
        'creative-factory',
        job.brandKey,
        `batch:${job.batchId}`,
        `template:${job.templateKey}`,
      ],
      folder: 'Creative Factory',
      createdBy: job.createdBy,
      notes:
        `固定模板 ${job.templateKey} v${job.templateVersion}；意图：${job.intent}`.slice(
          0,
          1000,
        ),
    })
  job.outputMaterialId = material._id
  job.status = 'ready'
  job.pipeline.status = 'completed'
  job.pipeline.currentStep = 'completed'
  job.pipeline.progressLabel = '已进素材库'
  job.pipeline.completedAt = new Date()
  job.pipeline.leaseUntil = undefined
  job.pipeline.leaseOwner = undefined
  job.codex.outputs = [
    {
      role: 'final',
      mediaType: 'video',
      storageProvider: 'r2',
      storageKey: upload.key,
      url: upload.url,
    },
  ]
  await job.save()
}

async function executeClaimedJob(job: any) {
  const template = getCreativeFactoryTemplate(job.templateKey)
  if (!template) throw new Error('生产模板不存在或已停用')
  const steps = stepsFor(job)
  const generationSteps: GenerationSpec[] = [
    {
      key: 'closeup_image',
      label: template.steps[0],
      featureKey: 'qwen_edit',
      sourceUrl: job.source.url,
      templateId: template.generation.imageTemplateId,
      creativeDirection: template.generation.closeupPrompt,
      imageOperation: 'sfw',
    },
    {
      key: 'pool_sfw_image',
      label: template.steps[1],
      featureKey: 'qwen_edit',
      sourceUrl: job.source.url,
      templateId: template.generation.imageTemplateId,
      creativeDirection: template.generation.poolSfwPrompt,
      imageOperation: 'sfw',
    },
    {
      key: 'pool_nsfw_image',
      label: template.steps[2],
      featureKey: 'qwen_edit',
      sourceUrl: steps.pool_sfw_image?.resultUrl || '',
      templateId: template.generation.imageTemplateId,
      creativeDirection: template.generation.poolNsfwPrompt,
      imageOperation: 'undress',
    },
    {
      key: 'sfw_video',
      label: 'SFW 图生视频',
      featureKey: 'creative_factory_video',
      sourceUrl: steps.closeup_image?.resultUrl || '',
      templateId: template.generation.sfwVideoTemplateId,
    },
    {
      key: 'nsfw_video',
      label: 'NSFW 图生视频',
      featureKey: 'creative_factory_video',
      sourceUrl: steps.pool_nsfw_image?.resultUrl || '',
      templateId: template.generation.nsfwVideoTemplateId,
    },
  ]
  for (const spec of generationSteps) {
    if (stepsFor(job)[spec.key]?.status === 'completed') continue
    if (!spec.sourceUrl) throw new Error(`${spec.label}缺少上一步结果`)
    await runGenerationStep(job, spec)
    return
  }

  const audioUrl = process.env[template.composition.audioUrlEnv]
  if (!audioUrl) {
    throw new Error(`${template.composition.audioUrlEnv} 未配置`)
  }
  const workdir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'autoark-dual-scene-'),
  )
  try {
    const outputPath = path.join(workdir, 'final.mp4')
    job.pipeline.currentStep = 'compose'
    job.pipeline.progressLabel = template.steps[4]
    await job.save()
    const meta = await composeDualSceneVideo({
      sfwVideoUrl: stepsFor(job).sfw_video.resultUrl as string,
      nsfwVideoUrl: stepsFor(job).nsfw_video.resultUrl as string,
      audioUrl,
      outputPath,
    })
    await finishJob(job, outputPath, meta)
  } finally {
    await fs.rm(workdir, { recursive: true, force: true })
  }
}

async function recordFailure(job: any, error: Error) {
  const attempts = Number(job.pipeline?.attempts || 0) + 1
  const terminal = attempts >= MAX_TRANSIENT_ATTEMPTS
  job.pipeline.attempts = attempts
  job.pipeline.lastError = error.message.slice(0, 1600)
  job.pipeline.nextAttemptAt = new Date(
    Date.now() + Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), 5 * 60_000),
  )
  job.pipeline.leaseOwner = undefined
  job.pipeline.leaseUntil = undefined
  if (terminal) {
    job.pipeline.status = 'failed'
    job.status = 'failed'
    job.error = `模板流水线失败：${error.message}`.slice(0, 2000)
  } else {
    job.pipeline.status = 'queued'
    job.status = 'generating'
  }
  await job.save()
}

export async function processNextTemplateJob(workerId: string) {
  const now = new Date()
  const job: any = await CreativeFactoryJob.findOneAndUpdate(
    {
      templateKey: DUAL_SCENE_TEMPLATE_KEY,
      'pipeline.status': { $in: ['queued', 'processing'] },
      $and: [
        {
          $or: [
            { 'pipeline.nextAttemptAt': { $exists: false } },
            { 'pipeline.nextAttemptAt': { $lte: now } },
          ],
        },
        {
          $or: [
            { 'pipeline.leaseUntil': { $exists: false } },
            { 'pipeline.leaseUntil': { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        'pipeline.status': 'processing',
        'pipeline.leaseOwner': workerId,
        'pipeline.leaseUntil': new Date(now.getTime() + LEASE_MS),
        'pipeline.startedAt': now,
      },
    },
    { new: true, sort: { createdAt: 1 } },
  )
  if (!job) return false

  try {
    await executeClaimedJob(job)
    if (job.pipeline.status !== 'completed') {
      job.pipeline.status = 'queued'
      job.pipeline.leaseOwner = undefined
      job.pipeline.leaseUntil = undefined
      await job.save()
    }
  } catch (error: any) {
    logger.error('[CreativeFactoryTemplateWorker] Job step failed', {
      jobId: String(job._id),
      templateKey: job.templateKey,
      step: job.pipeline?.currentStep,
      error: error.message,
    })
    await recordFailure(job, error)
  }
  return true
}
