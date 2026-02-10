import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

declare global {
  namespace Express {
    interface Request { user?: { id: string; username: string; role: string } }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as any
    req.user = { id: payload.id, username: payload.username, role: payload.role }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}
