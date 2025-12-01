import logger from '../utils/logger'

export interface RecommendedAction {
  type: string
  params: any
  confidence: number
  mappedRuleAction?: string
}

export const mapRecommendations = (aiOutput: any): RecommendedAction[] => {
  const actions: RecommendedAction[] = []

  if (!aiOutput || !aiOutput.recommendations) {
    return actions
  }

  for (const rec of aiOutput.recommendations) {
    const action: RecommendedAction = {
      type: rec.action,
      params: rec.params || {},
      confidence: rec.confidence,
    }

    // Map AI abstract actions to system specific rule actions
    switch (rec.action) {
      case 'INCREASE_BUDGET':
        action.mappedRuleAction = 'INCREASE_BUDGET'
        break
      case 'DECREASE_BUDGET':
        action.mappedRuleAction = 'DECREASE_BUDGET'
        break
      case 'PAUSE_AD':
        action.mappedRuleAction = 'PAUSE_AD'
        break
      case 'RESUME_AD':
        action.mappedRuleAction = 'RESUME_AD'
        break
      // 'CHANGE_CREATIVE' might not have a direct rule action yet
      default:
        action.mappedRuleAction = 'MANUAL_REVIEW'
    }

    if (action.confidence > 0.7) {
      actions.push(action)
    } else {
      logger.info(
        `[AI Recommender] Skipping low confidence action: ${rec.action} (${rec.confidence})`,
      )
    }
  }

  return actions
}
