import logger from '../utils/logger'
// import * as facebookService from '../services/facebook.service'; // TODO: Implement write methods in service

export const increaseBudget = async (adsetId: string, ratio: number) => {
  logger.info(
    `[Action] Increasing budget for AdSet ${adsetId} by ${ratio * 100}%`,
  )
  // TODO: Call Facebook API to update adset budget
  // const adset = await facebookService.getAdSet(adsetId);
  // const newBudget = adset.daily_budget * (1 + ratio);
  // await facebookService.updateAdSet(adsetId, { daily_budget: newBudget });
}

export const decreaseBudget = async (adsetId: string, ratio: number) => {
  logger.info(
    `[Action] Decreasing budget for AdSet ${adsetId} by ${ratio * 100}%`,
  )
  // TODO: Call Facebook API to update adset budget
  // const adset = await facebookService.getAdSet(adsetId);
  // const newBudget = adset.daily_budget * (1 - ratio);
  // await facebookService.updateAdSet(adsetId, { daily_budget: newBudget });
}

export const pauseAd = async (adId: string) => {
  logger.info(`[Action] Pausing Ad ${adId}`)
  // TODO: Call Facebook API to update ad status
  // await facebookService.updateAd(adId, { status: 'PAUSED' });
}

export const resumeAd = async (adId: string) => {
  logger.info(`[Action] Resuming Ad ${adId}`)
  // TODO: Call Facebook API to update ad status
  // await facebookService.updateAd(adId, { status: 'ACTIVE' });
}

export const executeAction = async (
  actionType: string,
  targetId: string,
  params: any,
) => {
  switch (actionType) {
    case 'INCREASE_BUDGET':
      await increaseBudget(targetId, params.amount)
      break
    case 'DECREASE_BUDGET':
      await decreaseBudget(targetId, params.amount)
      break
    case 'PAUSE_AD':
      await pauseAd(targetId)
      break
    case 'RESUME_AD':
      await resumeAd(targetId)
      break
    default:
      logger.error(`Unknown action type: ${actionType}`)
  }
}
