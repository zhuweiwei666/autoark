import { Request, Response } from 'express'
import logger from '../utils/logger'
import {
  getCommercialOrganizationReadiness,
  getCommercialPlans,
  getCommercialReadiness,
  getCommercialSupportPackage,
} from '../services/commercial.service'

export const getReadiness = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const data = await getCommercialReadiness(
      req.user,
      typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined,
    )

    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get readiness failed:', error)
    const message = error.message || '获取商用状态失败'
    const status = message.includes('无权') || message.includes('未关联') ? 403 : 500
    res.status(status).json({ success: false, message })
  }
}

export const getPlans = async (_req: Request, res: Response) => {
  res.json({ success: true, data: getCommercialPlans() })
}

export const getOrganizationReadiness = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const data = await getCommercialOrganizationReadiness(req.user)
    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get organization readiness failed:', error)
    const message = error.message || '获取客户商用状态失败'
    const status = message.includes('无权') ? 403 : 500
    res.status(status).json({ success: false, message })
  }
}

export const getSupportPackage = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: '未认证' })
    }

    const data = await getCommercialSupportPackage(
      req.user,
      typeof req.query.organizationId === 'string' ? req.query.organizationId : undefined,
    )
    res.json({ success: true, data })
  } catch (error: any) {
    logger.error('[Commercial] Get support package failed:', error)
    const message = error.message || '生成客户支持包失败'
    const status = message.includes('无权') || message.includes('未关联') ? 403 : 500
    res.status(status).json({ success: false, message })
  }
}
