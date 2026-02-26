import { Router } from 'express'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({
    enabled: true,
    strategy: 'roas_hard_guardrail',
    rollout: {
      mode: 'parallel',
      canRollback: true,
      metrics: ['qa_questions', 'approval_pass_rate', 'error_action_rate', 'decision_latency_ms'],
    },
  })
})

export default router
