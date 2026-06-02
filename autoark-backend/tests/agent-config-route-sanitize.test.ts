import express from 'express'
import request from 'supertest'
import { UserRole } from '../src/models/User'

const mockCreateAgent = jest.fn()
const mockUpdateAgent = jest.fn()

const mockAuthState: { user: any } = {
  user: {
    role: UserRole.SUPER_ADMIN,
    userId: '665000000000000000000002',
    organizationId: '665000000000000000000001',
  },
}

jest.mock('../src/middlewares/auth', () => {
  const actual = jest.requireActual('../src/middlewares/auth')
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = mockAuthState.user
      next()
    },
  }
})

jest.mock('../src/domain/agent/agent.service', () => ({
  agentService: {
    createAgent: mockCreateAgent,
    updateAgent: mockUpdateAgent,
  },
}))

import agentRoutes from '../src/domain/agent/agent.controller'

const createApp = () => {
  const app = express()
  app.use(express.json())
  app.use('/api/agent', agentRoutes)
  return app
}

describe('agent config route sanitization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.user = {
      role: UserRole.SUPER_ADMIN,
      userId: '665000000000000000000002',
      organizationId: '665000000000000000000001',
    }
    mockCreateAgent.mockResolvedValue({ _id: 'agent_1', name: 'Launch Agent' })
    mockUpdateAgent.mockResolvedValue({ _id: 'agent_1', name: 'Updated Agent' })
  })

  it('sanitizes agent creation payloads before saving', async () => {
    const response = await request(createApp())
      .post('/api/agent/agents')
      .send({
        name: '  Launch Agent  ',
        description: `  ${'d'.repeat(1200)}  `,
        status: 'active',
        mode: 'auto',
        runtime: { lastRunAt: '2026-06-01T00:00:00.000Z' },
        createdBy: 'attacker',
        organizationId: '665000000000000000000099',
        scope: {
          adAccountIds: ['act_1', { $ne: '' }, 'act_1', 'act_2'],
          fbTokenIds: ['665000000000000000000201'],
          materials: {
            allowAll: false,
            materialIds: ['665000000000000000000301', { $ne: '' }],
          },
        },
        permissions: {
          canPublishAds: true,
          canAdjustBid: 'yes',
        },
        objectives: {
          targetRoas: 200,
          maxCpa: -5,
          dailyBudgetLimit: 999999999,
        },
        rules: {
          autoStop: { enabled: true, minDays: 0, minSpend: 20 },
          autoScale: { enabled: true, budgetIncrease: 20 },
          budgetAdjust: { enabled: true, adjustFrequency: 'hourly' },
        },
        aiConfig: {
          useAiDecision: true,
          aiDecisionWeight: 5,
          requireApproval: true,
          approvalThreshold: 999999999,
        },
        scoringConfig: {
          stages: [{
            name: 'Cold Start',
            minSpend: 0,
            maxSpend: 20,
            weights: { cpm: 0.4, ctr: 3, unknown: 1 },
          }],
          momentumSensitivity: 5,
          baselines: { cpm: 20, ctr: 2 },
        },
        actionThresholds: {
          aggressiveScale: { minScore: 500, changePercent: 500 },
          stopLoss: { maxScore: 30, changePercent: -500 },
        },
        feishuConfig: {
          enabled: true,
          appId: '  cli_xxx  ',
          appSecret: 'secret',
          receiveId: 'chat_xxx',
          receiveIdType: 'invalid',
        },
      })

    expect(response.status).toBe(201)
    const payload = mockCreateAgent.mock.calls[0][0]
    expect(payload.name).toBe('Launch Agent')
    expect(payload.description).toHaveLength(1000)
    expect(payload.status).toBe('active')
    expect(payload.mode).toBe('auto')
    expect(payload.createdBy).toBe('665000000000000000000002')
    expect(payload.organizationId).toBe('665000000000000000000099')
    expect(payload.scope.adAccountIds).toEqual(['act_1', 'act_2'])
    expect(payload.scope.materials).toEqual({
      allowAll: false,
      materialIds: ['665000000000000000000301'],
    })
    expect(payload.permissions).toEqual({ canPublishAds: true })
    expect(payload.objectives).toEqual({
      targetRoas: 100,
      maxCpa: 0,
      dailyBudgetLimit: 10000000,
    })
    expect(payload.rules.autoStop).toEqual({ enabled: true, minDays: 1, minSpend: 20 })
    expect(payload.rules.autoScale).toEqual({ enabled: true, budgetIncrease: 10 })
    expect(payload.rules.budgetAdjust).toEqual({ enabled: true })
    expect(payload.aiConfig).toEqual({
      useAiDecision: true,
      aiDecisionWeight: 1,
      requireApproval: true,
      approvalThreshold: 10000000,
    })
    expect(payload.scoringConfig.stages[0].weights).toEqual({ cpm: 0.4, ctr: 1 })
    expect(payload.scoringConfig.momentumSensitivity).toBe(1)
    expect(payload.scoringConfig.baselines).toEqual({ cpm: 20, ctr: 1 })
    expect(payload.actionThresholds.aggressiveScale).toEqual({ minScore: 100, changePercent: 100 })
    expect(payload.actionThresholds.stopLoss).toEqual({ maxScore: 30, changePercent: -100 })
    expect(payload.feishuConfig).toEqual({
      enabled: true,
      appId: 'cli_xxx',
      appSecret: 'secret',
      receiveId: 'chat_xxx',
    })
    expect(payload).not.toHaveProperty('runtime')
  })

  it('sanitizes agent update payloads before saving', async () => {
    const response = await request(createApp())
      .put('/api/agent/agents/agent_1')
      .send({
        name: 'Updated Agent',
        status: 'published',
        mode: 'root',
        runtime: { lastRunAt: '2026-06-01T00:00:00.000Z' },
        createdBy: 'attacker',
        organizationId: '665000000000000000000099',
        scope: {
          adAccountIds: ['act_1', { $ne: '' }],
        },
      })

    expect(response.status).toBe(200)
    expect(mockUpdateAgent).toHaveBeenCalledWith('agent_1', {
      name: 'Updated Agent',
      scope: { adAccountIds: ['act_1'] },
    })
  })

  it('rejects agent creation without a safe name', async () => {
    const response = await request(createApp())
      .post('/api/agent/agents')
      .send({ name: { $ne: '' } })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({ success: false, error: '请输入 Agent 名称' })
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })
})
