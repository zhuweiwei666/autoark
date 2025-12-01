import { Request, Response, NextFunction } from 'express'
import * as fbSyncService from '../services/facebook.sync.service'
import { SyncLog } from '../models'

export const runSync = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Run in background to avoid timeout
    fbSyncService.runFullSync()

    res.json({
      success: true,
      message: 'Full sync started in background',
    })
  } catch (error) {
    next(error)
  }
}

export const getStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const lastLogs = await SyncLog.find().sort({ startTime: -1 }).limit(5)
    res.json({
      success: true,
      data: lastLogs,
    })
  } catch (error) {
    next(error)
  }
}
