import { Request, Response } from 'express';
import * as facebookService from '../services/facebook.service';

export const getCampaigns = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = await facebookService.getCampaigns(id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getAdSets = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = await facebookService.getAdSets(id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getAds = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = await facebookService.getAds(id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

export const getInsightsDaily = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const data = await facebookService.getInsightsDaily(id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
};

