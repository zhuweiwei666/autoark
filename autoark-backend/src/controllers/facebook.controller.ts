import { Request, Response, NextFunction } from 'express'
import * as facebookService from '../services/facebook.service'
import { getEffectiveAdAccounts } from '../services/facebook.sync.service'

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
