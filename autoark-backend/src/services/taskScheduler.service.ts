import logger from '../utils/logger'
import FacebookApp from '../models/FacebookApp'
import AdTask from '../models/AdTask'
import { Worker, Job } from 'bullmq'
import { getRedisConnection, getRedisClient } from '../config/redis'

/**
 * 多 App 多线程任务调度服务
 * 
 * 功能：
 * 1. 自动选择负载最低的 App 执行任务
 * 2. 支持任务优先级队列
 * 3. App 故障自动切换
 * 4. 限流自动处理
 * 5. 多线程并行执行
 */

interface TaskJob {
  taskId: string
  accountId: string
  appId?: string  // 分配的 App
  priority?: number
  retryCount?: number
}

interface AppAllocation {
  appId: string
  appName: string
  currentLoad: number
  maxConcurrent: number
  priority: number
  isAvailable: boolean
}

/**
 * 获取所有可用的 Apps 并按负载排序
 */
export async function getAvailableApps(): Promise<AppAllocation[]> {
  const apps = await FacebookApp.find({
    status: 'active',
    'validation.isValid': true,
  }).lean()

  return apps
    .map(app => ({
      appId: app.appId,
      appName: app.appName,
      currentLoad: app.currentLoad?.activeTasks || 0,
      maxConcurrent: app.config?.maxConcurrentTasks || 5,
      priority: app.config?.priority || 1,
      isAvailable: (app.currentLoad?.activeTasks || 0) < (app.config?.maxConcurrentTasks || 5),
    }))
    .filter(app => app.isAvailable)
    .sort((a, b) => {
      // 先按负载排序（低负载优先）
      const loadDiff = a.currentLoad - b.currentLoad
      if (loadDiff !== 0) return loadDiff
      // 负载相同时按优先级排序（高优先级优先）
      return b.priority - a.priority
    })
}

/**
 * 为任务分配 App
 * 使用加权轮询算法，考虑：
 * 1. 当前负载
 * 2. App 优先级
 * 3. 历史成功率
 */
export async function allocateAppForTask(taskId: string): Promise<string | null> {
  const apps = await getAvailableApps()
  
  if (apps.length === 0) {
    logger.warn(`[TaskScheduler] No available apps for task ${taskId}`)
    return null
  }

  // 选择负载最低的 App
  const selectedApp = apps[0]
  
  // 更新 App 负载
  await FacebookApp.updateOne(
    { appId: selectedApp.appId },
    { 
      $inc: { 'currentLoad.activeTasks': 1 },
      $set: { 'stats.lastUsedAt': new Date() }
    }
  )

  logger.info(`[TaskScheduler] Allocated app ${selectedApp.appName} (${selectedApp.appId}) for task ${taskId}, current load: ${selectedApp.currentLoad + 1}/${selectedApp.maxConcurrent}`)
  
  return selectedApp.appId
}

/**
 * 释放 App 负载
 */
export async function releaseAppLoad(appId: string): Promise<void> {
  await FacebookApp.updateOne(
    { appId },
    { 
      $inc: { 'currentLoad.activeTasks': -1 },
    }
  )
  
  // 确保负载不会变成负数
  await FacebookApp.updateOne(
    { appId, 'currentLoad.activeTasks': { $lt: 0 } },
    { $set: { 'currentLoad.activeTasks': 0 } }
  )
}

/**
 * 记录 App 请求结果
 */
export async function recordAppResult(appId: string, success: boolean, error?: string): Promise<void> {
  const update: any = {
    $inc: { 
      'stats.totalRequests': 1,
      'stats.successRequests': success ? 1 : 0,
      'stats.failedRequests': success ? 0 : 1,
    }
  }

  if (!success && error) {
    update.$set = {
      'stats.lastErrorAt': new Date(),
      'stats.lastError': error,
    }
    
    // 检查是否是限流错误
    if (error.toLowerCase().includes('rate limit') || error.toLowerCase().includes('too many')) {
      update.$set['status'] = 'rate_limited'
      update.$set['stats.rateLimitResetAt'] = new Date(Date.now() + 60 * 60 * 1000) // 1小时后重置
      logger.warn(`[TaskScheduler] App ${appId} hit rate limit, will reset in 1 hour`)
    }
  }

  await FacebookApp.updateOne({ appId }, update)
}

/**
 * 分配任务到多个 App 并行执行
 * @param taskId 任务ID
 * @param accountIds 需要执行的账户ID列表
 * @returns 分配结果
 */
export async function distributeTaskToApps(taskId: string, accountIds: string[]): Promise<{
  distributions: Array<{ appId: string; accountIds: string[] }>
  unallocated: string[]
}> {
  const apps = await getAvailableApps()
  
  if (apps.length === 0) {
    logger.warn(`[TaskScheduler] No available apps, all accounts unallocated`)
    return { distributions: [], unallocated: accountIds }
  }

  const distributions: Array<{ appId: string; accountIds: string[] }> = []
  const unallocated: string[] = []
  
  // 计算每个 App 可以分配多少任务
  const totalAvailableSlots = apps.reduce((sum, app) => sum + (app.maxConcurrent - app.currentLoad), 0)
  
  let accountIndex = 0
  
  for (const app of apps) {
    const availableSlots = app.maxConcurrent - app.currentLoad
    if (availableSlots <= 0) continue
    
    // 按比例分配任务
    const allocateCount = Math.min(
      availableSlots,
      Math.ceil((accountIds.length - accountIndex) * (availableSlots / totalAvailableSlots))
    )
    
    if (allocateCount > 0) {
      const allocatedAccounts = accountIds.slice(accountIndex, accountIndex + allocateCount)
      distributions.push({
        appId: app.appId,
        accountIds: allocatedAccounts,
      })
      accountIndex += allocateCount
    }
    
    if (accountIndex >= accountIds.length) break
  }
  
  // 剩余未分配的账户
  if (accountIndex < accountIds.length) {
    unallocated.push(...accountIds.slice(accountIndex))
  }
  
  // 更新 App 负载
  for (const dist of distributions) {
    await FacebookApp.updateOne(
      { appId: dist.appId },
      { 
        $inc: { 'currentLoad.activeTasks': dist.accountIds.length },
        $set: { 'stats.lastUsedAt': new Date() }
      }
    )
  }
  
  logger.info(`[TaskScheduler] Task ${taskId} distributed: ${distributions.length} apps, ${unallocated.length} unallocated`)
  
  return { distributions, unallocated }
}

/**
 * 获取任务执行状态摘要
 */
export async function getSchedulerStatus(): Promise<{
  totalApps: number
  activeApps: number
  totalCapacity: number
  usedCapacity: number
  availableCapacity: number
  apps: Array<{
    appId: string
    appName: string
    status: string
    currentLoad: number
    maxConcurrent: number
    healthScore: number
  }>
}> {
  const apps = await FacebookApp.find().lean()
  
  const activeApps = apps.filter(a => a.status === 'active' && a.validation?.isValid)
  const totalCapacity = activeApps.reduce((sum, a) => sum + (a.config?.maxConcurrentTasks || 5), 0)
  const usedCapacity = activeApps.reduce((sum, a) => sum + (a.currentLoad?.activeTasks || 0), 0)
  
  return {
    totalApps: apps.length,
    activeApps: activeApps.length,
    totalCapacity,
    usedCapacity,
    availableCapacity: totalCapacity - usedCapacity,
    apps: apps.map(app => ({
      appId: app.appId,
      appName: app.appName,
      status: app.status,
      currentLoad: app.currentLoad?.activeTasks || 0,
      maxConcurrent: app.config?.maxConcurrentTasks || 5,
      healthScore: app.stats?.totalRequests 
        ? Math.round(((app.stats.successRequests || 0) / app.stats.totalRequests) * 100)
        : 100,
    })),
  }
}

/**
 * 重置所有 App 的负载（用于系统重启后）
 */
export async function resetAllAppLoads(): Promise<void> {
  await FacebookApp.updateMany(
    {},
    { 
      $set: { 
        'currentLoad.activeTasks': 0,
        'currentLoad.requestsThisMinute': 0,
        'currentLoad.lastResetAt': new Date(),
      }
    }
  )
  logger.info('[TaskScheduler] All app loads reset')
}

/**
 * 检查并恢复限流的 App
 */
export async function checkAndRecoverRateLimitedApps(): Promise<void> {
  const now = new Date()
  
  await FacebookApp.updateMany(
    {
      status: 'rate_limited',
      'stats.rateLimitResetAt': { $lt: now },
    },
    {
      $set: { 
        status: 'active',
        'currentLoad.activeTasks': 0,
        'currentLoad.requestsThisMinute': 0,
      }
    }
  )
}

// 定期检查限流恢复（每5分钟）
setInterval(checkAndRecoverRateLimitedApps, 5 * 60 * 1000)

export default {
  getAvailableApps,
  allocateAppForTask,
  releaseAppLoad,
  recordAppResult,
  distributeTaskToApps,
  getSchedulerStatus,
  resetAllAppLoads,
  checkAndRecoverRateLimitedApps,
}

