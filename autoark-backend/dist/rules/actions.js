"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAction = exports.resumeAd = exports.pauseAd = exports.decreaseBudget = exports.increaseBudget = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
// import * as facebookService from '../services/facebook.service'; // TODO: Implement write methods in service
const increaseBudget = async (adsetId, ratio) => {
    logger_1.default.info(`[Action] Increasing budget for AdSet ${adsetId} by ${ratio * 100}%`);
    // TODO: Call Facebook API to update adset budget
    // const adset = await facebookService.getAdSet(adsetId);
    // const newBudget = adset.daily_budget * (1 + ratio);
    // await facebookService.updateAdSet(adsetId, { daily_budget: newBudget });
};
exports.increaseBudget = increaseBudget;
const decreaseBudget = async (adsetId, ratio) => {
    logger_1.default.info(`[Action] Decreasing budget for AdSet ${adsetId} by ${ratio * 100}%`);
    // TODO: Call Facebook API to update adset budget
    // const adset = await facebookService.getAdSet(adsetId);
    // const newBudget = adset.daily_budget * (1 - ratio);
    // await facebookService.updateAdSet(adsetId, { daily_budget: newBudget });
};
exports.decreaseBudget = decreaseBudget;
const pauseAd = async (adId) => {
    logger_1.default.info(`[Action] Pausing Ad ${adId}`);
    // TODO: Call Facebook API to update ad status
    // await facebookService.updateAd(adId, { status: 'PAUSED' });
};
exports.pauseAd = pauseAd;
const resumeAd = async (adId) => {
    logger_1.default.info(`[Action] Resuming Ad ${adId}`);
    // TODO: Call Facebook API to update ad status
    // await facebookService.updateAd(adId, { status: 'ACTIVE' });
};
exports.resumeAd = resumeAd;
const executeAction = async (actionType, targetId, params) => {
    switch (actionType) {
        case 'INCREASE_BUDGET':
            await (0, exports.increaseBudget)(targetId, params.amount);
            break;
        case 'DECREASE_BUDGET':
            await (0, exports.decreaseBudget)(targetId, params.amount);
            break;
        case 'PAUSE_AD':
            await (0, exports.pauseAd)(targetId);
            break;
        case 'RESUME_AD':
            await (0, exports.resumeAd)(targetId);
            break;
        default:
            logger_1.default.error(`Unknown action type: ${actionType}`);
    }
};
exports.executeAction = executeAction;
