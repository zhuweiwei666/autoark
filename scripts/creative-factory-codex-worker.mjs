#!/usr/bin/env node
import crypto from 'node:crypto'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const autoarkUrl = (process.env.AUTOARK_URL || 'http://localhost:3001').replace(/\/+$/, '')
const secret = process.env.CREATIVE_FACTORY_CODEX_SECRET || ''
const workerId = process.env.CODEX_WORKER_ID || `codex-worker-${os.hostname()}`
const codexExecutable = process.env.CODEX_EXECUTABLE || 'codex'
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const clientPath = path.join(repoRoot, 'scripts/creative-factory-codex-client.mjs')
const mediaRunnerPath = path.join(repoRoot, 'scripts/creative-factory-media.mjs')
const operatorDocPath = path.join(repoRoot, 'docs/creative-factory-codex-operator.md')

function usage() {
  process.stdout.write('Usage: node scripts/creative-factory-codex-worker.mjs [--once|--loop]\n')
}

async function signedPost(route, body) {
  if (!secret) throw new Error('CREATIVE_FACTORY_CODEX_SECRET 未配置')
  const serialized = JSON.stringify(body)
  const signature = crypto.createHmac('sha256', secret).update(serialized).digest('hex')
  const response = await fetch(`${autoarkUrl}/api/creative-factory${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Codex-Signature': signature },
    body: serialized,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success === false) throw new Error(payload?.message || `AutoArk 请求失败 (${response.status})`)
  return payload.data
}

function runCodex(workdir, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexExecutable, [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '-c',
      'approval_policy="never"',
      '-c',
      'sandbox_workspace_write.network_access=true',
      '-C',
      workdir,
      prompt,
    ], { stdio: 'inherit', env: process.env })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Codex exited with ${code}`)))
  })
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}`)))
  })
}

const mediaExtension = (media) => {
  try {
    const ext = path.extname(new URL(media.url).pathname).toLowerCase()
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext
  } catch {}
  return media.mediaType === 'video' ? '.mp4' : '.jpg'
}

async function downloadMedia(media, targetPath) {
  const existing = await fs.stat(targetPath).catch(() => null)
  if (existing?.size) return targetPath
  const response = await fetch(media.url)
  if (!response.ok || !response.body) throw new Error(`下载素材失败 (${response.status})`)
  const temporaryPath = `${targetPath}.downloading-${process.pid}`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath))
    await fs.rename(temporaryPath, targetPath)
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {})
    throw error
  }
  return targetPath
}

async function probeDuration(input) {
  const chunks = []
  await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', input,
    ])
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => code === 0
      ? resolve()
      : reject(new Error(`ffprobe exited with ${code}`)))
  })
  return Math.max(Number(Buffer.concat(chunks).toString('utf8').trim()) || 0, 0)
}

async function extractInspectionFrames(input, outputDir) {
  const duration = await probeDuration(input)
  const frameCount = duration > 0 ? 6 : 1
  const frames = []
  await fs.mkdir(outputDir, { recursive: true })
  for (let index = 0; index < frameCount; index += 1) {
    const timestamp = duration > 0
      ? Math.min(duration * ((index + 0.5) / frameCount), Math.max(duration - 0.05, 0))
      : 0
    const output = path.join(outputDir, `frame-${String(index + 1).padStart(2, '0')}.jpg`)
    await run('ffmpeg', [
      '-y', '-ss', timestamp.toFixed(3), '-i', input,
      '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '2', output,
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    frames.push(output)
  }
  return { duration, frames }
}

async function prepareInspection(job, workdir) {
  const sourcePath = path.join(workdir, `source${mediaExtension(job.source)}`)
  await downloadMedia(job.source, sourcePath)
  const sourceInspection = job.source.mediaType === 'video'
    ? await extractInspectionFrames(sourcePath, path.join(workdir, 'source-frames'))
    : { frames: [sourcePath] }

  let styleReference = null
  if (job.styleReference?.url) {
    if (job.styleReference?.analysis?.status === 'completed') {
      return {
        source: { path: sourcePath, ...sourceInspection },
        styleReference: { analysisReused: true },
      }
    }
    const batchRoot = path.join(
      os.tmpdir(),
      'autoark-creative-factory',
      'reference-cache',
      String(job.batchId),
    )
    await fs.mkdir(batchRoot, { recursive: true })
    const referencePath = path.join(batchRoot, `reference${mediaExtension(job.styleReference)}`)
    await downloadMedia(job.styleReference, referencePath)
    const referenceInspection = job.styleReference.mediaType === 'video'
      ? await extractInspectionFrames(referencePath, path.join(batchRoot, 'frames'))
      : { frames: [referencePath] }
    styleReference = { path: referencePath, ...referenceInspection }
  }

  return {
    source: { path: sourcePath, ...sourceInspection },
    styleReference,
  }
}

async function processOne() {
  const claimed = await signedPost('/codex/claim', { workerId })
  if (!claimed?.job) return false
  const job = claimed.job
  const workdir = path.join(os.tmpdir(), 'autoark-creative-factory', String(job._id))
  await fs.mkdir(workdir, { recursive: true })
  const localInspection = await prepareInspection(job, workdir)
  await fs.writeFile(
    path.join(workdir, 'task.json'),
    JSON.stringify({ ...job, localInspection }, null, 2),
  )

  const prompt = `你是 AutoArk Creative Factory 的受控 Codex 媒体执行器。只处理 task.json 里的一个任务，不修改任何项目源码。\n\n` +
    `必须完整阅读 ${operatorDocPath}，使用 ${clientPath} 与 AutoArk 交互，使用 ${mediaRunnerPath} 执行图片或视频处理。` +
    `当前 workerId 已通过 CODEX_WORKER_ID 环境变量传入。task.json 的 localInspection 已包含来源素材和素材示例的本地文件/抽帧路径。先逐张检查实际画面，再做意图分析；所有原品牌 logo、文字、水印、配色和片尾都要在抽帧检查后列入 editRecipe。` +
    `如果 styleReference.analysis 尚未 completed，必须从示例中提取构图、配色、字体、钩子、节奏、转场、字幕、CTA 和音频特征并提交 referenceAnalysis；若已 completed，直接复用批次分析，不得重复调用生成模型分析示例。` +
    `若任务需要 ai-host，提交 plan 后轮询 refresh；生成成功后下载 aiHost.resultUrl。成品必须上传 R2 并 complete，不能把本地路径当成成品 URL。` +
    `完成前检查首帧、中段、尾帧、尺寸、编码和音轨。遇到确定不可恢复的素材问题才调用 fail；短暂网络错误应保留任务等待租约重试。\n\n` +
    `任务文件：${path.join(workdir, 'task.json')}\n工作目录：${workdir}`

  await runCodex(workdir, prompt)
  return true
}

async function main() {
  const mode = process.argv[2] || '--once'
  if (mode === '--help') return usage()
  if (!['--once', '--loop'].includes(mode)) throw new Error(`未知参数: ${mode}`)

  do {
    const processed = await processOne()
    if (mode === '--once') break
    await new Promise((resolve) => setTimeout(resolve, processed ? 1_000 : 15_000))
  } while (mode === '--loop')
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
