/**
 * 对话 API - Agent 聊天接口
 */
import { Router, Request, Response } from 'express'
import { authenticate } from '../auth/auth.middleware'
import { chat } from '../agent/agent'
import { Conversation } from './conversation.model'

const router = Router()
router.use(authenticate)

// 发送消息（核心接口）
router.post('/send', async (req: Request, res: Response) => {
  const { conversationId, message } = req.body
  if (!message) return res.status(400).json({ error: 'message is required' })

  try {
    const result = await chat(req.user!.id, conversationId, message)
    res.json(result)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// 获取对话列表
router.get('/', async (req: Request, res: Response) => {
  const conversations = await Conversation.find({ userId: req.user!.id })
    .select('title status createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean()
  res.json(conversations)
})

// 获取对话详情（含消息历史）
router.get('/:id', async (req: Request, res: Response) => {
  const convo = await Conversation.findOne({ _id: req.params.id, userId: req.user!.id }).lean()
  if (!convo) return res.status(404).json({ error: 'Conversation not found' })
  res.json(convo)
})

// 删除对话
router.delete('/:id', async (req: Request, res: Response) => {
  await Conversation.updateOne({ _id: req.params.id, userId: req.user!.id }, { status: 'archived' })
  res.json({ success: true })
})

export default router
