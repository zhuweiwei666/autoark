import FacebookApp from '../src/models/FacebookApp'
import {
  assignableBulkAdAppQuery,
  getAvailableApps,
  getSchedulerStatus,
} from '../src/services/taskScheduler.service'

const mockFindLean = (docs: any[]) => {
  const lean = jest.fn().mockResolvedValue(docs)
  jest.spyOn(FacebookApp, 'find').mockReturnValue({ lean } as any)
  return { lean }
}

describe('task scheduler app selection', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('queries only apps enabled for bulk ads and filters disabled apps defensively', async () => {
    mockFindLean([
      {
        appId: 'app_disabled',
        appName: 'Disabled App',
        status: 'active',
        validation: { isValid: true },
        config: { enabledForBulkAds: false, maxConcurrentTasks: 5, priority: 10 },
        currentLoad: { activeTasks: 0 },
      },
      {
        appId: 'app_ready',
        appName: 'Ready App',
        status: 'active',
        validation: { isValid: true },
        config: { enabledForBulkAds: true, maxConcurrentTasks: 5, priority: 1 },
        currentLoad: { activeTasks: 0 },
      },
    ])

    const apps = await getAvailableApps()

    expect(FacebookApp.find).toHaveBeenCalledWith(assignableBulkAdAppQuery)
    expect(apps.map(app => app.appId)).toEqual(['app_ready'])
  })

  it('excludes disabled apps from scheduler capacity', async () => {
    mockFindLean([
      {
        appId: 'app_disabled',
        appName: 'Disabled App',
        status: 'active',
        validation: { isValid: true },
        config: { enabledForBulkAds: false, maxConcurrentTasks: 5 },
        currentLoad: { activeTasks: 0 },
        stats: { totalRequests: 0, successRequests: 0 },
      },
      {
        appId: 'app_ready',
        appName: 'Ready App',
        status: 'active',
        validation: { isValid: true },
        config: { enabledForBulkAds: true, maxConcurrentTasks: 3 },
        currentLoad: { activeTasks: 1 },
        stats: { totalRequests: 10, successRequests: 9 },
      },
    ])

    const status = await getSchedulerStatus()

    expect(status.totalApps).toBe(2)
    expect(status.activeApps).toBe(1)
    expect(status.totalCapacity).toBe(3)
    expect(status.usedCapacity).toBe(1)
    expect(status.availableCapacity).toBe(2)
  })
})
