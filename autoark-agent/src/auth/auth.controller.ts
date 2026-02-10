import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { User } from './user.model'
import { env } from '../config/env'
import { authenticate } from './auth.middleware'

const router = Router()

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body
  if (!username || !password) return res.status(400).json({ error: 'username and password required' })

  const user: any = await User.findOne({ username }).select('+password')
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  const token = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as any }
  )
  res.json({ token, user: { id: user._id, username: user.username, role: user.role } })
})

router.get('/me', authenticate, (req: Request, res: Response) => {
  res.json({ user: req.user })
})

export default router
