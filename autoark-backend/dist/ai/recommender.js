"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapRecommendations = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const mapRecommendations = (aiOutput) => {
    const actions = [];
    if (!aiOutput || !aiOutput.recommendations) {
        return actions;
    }
    for (const rec of aiOutput.recommendations) {
        const action = {
            type: rec.action,
            params: rec.params || {},
            confidence: rec.confidence,
        };
        // Map AI abstract actions to system specific rule actions
        switch (rec.action) {
            case 'INCREASE_BUDGET':
                action.mappedRuleAction = 'INCREASE_BUDGET';
                break;
            case 'DECREASE_BUDGET':
                action.mappedRuleAction = 'DECREASE_BUDGET';
                break;
            case 'PAUSE_AD':
                action.mappedRuleAction = 'PAUSE_AD';
                break;
            case 'RESUME_AD':
                action.mappedRuleAction = 'RESUME_AD';
                break;
            // 'CHANGE_CREATIVE' might not have a direct rule action yet
            default:
                action.mappedRuleAction = 'MANUAL_REVIEW';
        }
        if (action.confidence > 0.7) {
            actions.push(action);
        }
        else {
            logger_1.default.info(`[AI Recommender] Skipping low confidence action: ${rec.action} (${rec.confidence})`);
        }
    }
    return actions;
};
exports.mapRecommendations = mapRecommendations;
