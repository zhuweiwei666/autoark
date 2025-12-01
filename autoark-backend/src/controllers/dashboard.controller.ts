import { Request, Response, NextFunction } from 'express';
import * as dashboardService from '../services/dashboard.service';

const getFilters = (req: Request) => {
  const { startDate, endDate, channel, country } = req.query;
  
  // Default to last 7 days if not provided
  const end = (endDate as string) || new Date().toISOString().split('T')[0];
  const start = (startDate as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return {
    startDate: start,
    endDate: end,
    channel: channel as string,
    country: country as string
  };
};

export const getDaily = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = getFilters(req);
    const data = await dashboardService.getDaily(filters);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

export const getByCountry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = getFilters(req);
    const data = await dashboardService.getByCountry(filters);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

export const getByAdSet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = getFilters(req);
    const data = await dashboardService.getByAdSet(filters);
    res.json(data);
  } catch (error) {
    next(error);
  }
};

