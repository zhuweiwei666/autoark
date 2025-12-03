import { Request, Response, NextFunction } from 'express'
import * as facebookService from '../services/facebook.service'
import * as facebookAccountsService from '../services/facebook.accounts.service'
import * as facebookCampaignsService from '../services/facebook.campaigns.service'
import * as facebookCampaignsV2Service from '../services/facebook.campaigns.v2.service'
import * as facebookCountriesService from '../services/facebook.countries.service'
import { getEffectiveAdAccounts } from '../services/facebook.sync.service'

export const syncCampaigns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 使用新的队列系统（V2）
    const useV2 = req.query.v2 === 'true' || process.env.USE_QUEUE_SYNC === 'true'
    
    if (useV2) {
      const result = await facebookCampaignsV2Service.syncCampaignsFromAdAccountsV2()
      res.json({
        success: true,
        message: 'Campaigns sync queued (using BullMQ)',
        data: result,
      })
    } else {
      // 旧版本（同步执行）
      const result = await facebookCampaignsService.syncCampaignsFromAdAccounts()
      res.json({
        success: true,
        message: 'Campaigns sync completed',
        data: result,
      })
    }
  } catch (error) {
    next(error)
  }
}

// 获取队列状态
export const getQueueStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const status = await facebookCampaignsV2Service.getQueueStatus()
    res.json({
      success: true,
      data: status,
    })
  } catch (error) {
    next(error)
  }
}

export const getCampaignsList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 确保设置正确的 Content-Type
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const sortBy = (req.query.sortBy as string) || 'createdAt'
    const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc'
    const filters = {
        name: req.query.name,
        accountId: req.query.accountId,
        status: req.query.status,
        objective: req.query.objective,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
    }

    const result = await facebookCampaignsService.getCampaigns(filters, { page, limit, sortBy, sortOrder })
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    next(error)
  }
}

export const syncAccounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const result = await facebookAccountsService.syncAccountsFromTokens()
    res.json({
      success: true,
      message: 'Accounts sync completed',
      data: result,
    })
  } catch (error) {
    next(error)
  }
}

export const getAccountsList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const sortBy = (req.query.sortBy as string) || 'periodSpend'
    const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc'
    const filters = {
        optimizer: req.query.optimizer,
        status: req.query.status,
        accountId: req.query.accountId,
        name: req.query.name,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
    }

    const result = await facebookAccountsService.getAccounts(filters, { page, limit, sortBy, sortOrder })
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    next(error)
  }
}

export const getCountriesList = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // 确保设置正确的 Content-Type
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 20
    const sortBy = (req.query.sortBy as string) || 'spend'
    const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc'
    const filters = {
        name: req.query.name,
        accountId: req.query.accountId,
        status: req.query.status,
        objective: req.query.objective,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
    }

    const result = await facebookCountriesService.getCountries(filters, { page, limit, sortBy, sortOrder })
    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    next(error)
  }
}

export const getCampaigns = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = await facebookService.getCampaigns(id)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getAdSets = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = await facebookService.getAdSets(id)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getAds = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = await facebookService.getAds(id)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getInsightsDaily = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { id } = req.params
    const data = await facebookService.getInsightsDaily(id)
    res.json(data)
  } catch (error) {
    next(error)
  }
}

export const getAccounts = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const accounts = await getEffectiveAdAccounts()
    res.json({
      success: true,
      accounts,
    })
  } catch (error) {
    next(error)
  }
}
