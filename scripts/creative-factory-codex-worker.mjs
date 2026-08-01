#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

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

async function processOne() {
  const claimed = await signedPost('/codex/claim', { workerId })
  if (!claimed?.job) return false
  const job = claimed.job
  const workdir = path.join(os.tmpdir(), 'autoark-creative-factory', String(job._id))
  await fs.mkdir(workdir, { recursive: true })
  await fs.writeFile(path.join(workdir, 'task.json'), JSON.stringify(job, null, 2))

  const prompt = `你是 AutoArk Creative Factory 的受控 Codex 媒体执行器。只处理 task.json 里的一个任务，不修改任何项目源码。\n\n` +
    `必须完整阅读 ${operatorDocPath}，使用 ${clientPath} 与 AutoArk 交互，使用 ${mediaRunnerPath} 执行图片或视频处理。` +
    `当前 workerId 已通过 CODEX_WORKER_ID 环境变量传入。先检查来源素材实际画面，再做意图分析；所有原品牌 logo、文字、水印、配色和片尾都要在抽帧检查后列入 editRecipe。` +
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
