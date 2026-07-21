const { Queue } = require('bullmq')
const IORedis = require('ioredis')

const QUEUE_NAMES = [
  'facebook.account.sync',
  'facebook.campaign.sync',
  'facebook.ad.sync',
]
const PENDING_JOB_TYPES = ['wait', 'paused', 'delayed', 'prioritized']

const sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

const countPendingJobs = (counts) => (
  (counts.waiting || 0)
  + (counts.paused || 0)
  + (counts.delayed || 0)
  + (counts.prioritized || 0)
)

const removePendingJobs = async (queue) => {
  await queue.drain(true)

  for (const type of PENDING_JOB_TYPES) {
    while (true) {
      const jobs = await queue.getJobs([type], 0, 99, true)
      if (jobs.length === 0) break

      await Promise.all(jobs.map(async (job) => {
        try {
          await job.remove()
        } catch (error) {
          if (!String(error?.message || error).includes('locked')) throw error
        }
      }))
    }
  }
}

const main = async () => {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) throw new Error('REDIS_URL is not configured')

  const connections = []
  const queues = QUEUE_NAMES.map((name) => {
    const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
    connections.push(connection)
    return new Queue(name, { connection })
  })

  try {
    const before = {}
    for (const queue of queues) {
      before[queue.name] = await queue.getJobCounts()
    }

    await Promise.all(queues.map((queue) => queue.pause()))

    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const activeCounts = await Promise.all(queues.map((queue) => queue.getActiveCount()))
      if (activeCounts.every((count) => count === 0)) break
      await sleep(500)
    }

    const remainingActive = await Promise.all(queues.map((queue) => queue.getActiveCount()))
    if (remainingActive.some((count) => count > 0)) {
      throw new Error(`Timed out waiting for active Facebook sync jobs: ${remainingActive.join(',')}`)
    }

    await Promise.all(queues.map(removePendingJobs))

    const after = {}
    for (const queue of queues) {
      const counts = await queue.getJobCounts()
      after[queue.name] = {
        isPaused: await queue.isPaused(),
        counts,
      }
      if (!after[queue.name].isPaused || countPendingJobs(counts) !== 0 || (counts.active || 0) !== 0) {
        throw new Error(`Queue ${queue.name} did not reach a paused, idle state`)
      }
    }

    process.stdout.write(`${JSON.stringify({ before, after }, null, 2)}\n`)
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()))
    await Promise.allSettled(connections.map((connection) => connection.quit()))
    connections.forEach((connection) => connection.disconnect())
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`)
  process.exitCode = 1
})
