"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RULES = void 0;
exports.RULES = [
    {
        name: 'CPI_HIGH_REDUCE_BUDGET',
        description: 'If CPI is greater than $1.2, decrease budget by 20%',
        condition: (metrics) => metrics.cpiUsd > 1.2 && metrics.spendUsd > 20, // Added spend threshold to avoid premature action
        action: 'DECREASE_BUDGET',
        params: { amount: 0.2 },
    },
    {
        name: 'CPI_LOW_INCREASE_BUDGET',
        description: 'If CPI is less than $0.8 and Spend > $50, increase budget by 20%',
        condition: (metrics) => metrics.cpiUsd < 0.8 && metrics.spendUsd > 50,
        action: 'INCREASE_BUDGET',
        params: { amount: 0.2 },
    },
    {
        name: 'ROI_LOW_PAUSE_AD',
        description: 'If ROI D0 is less than 0.05 (5%) and Spend > $30, pause the ad',
        condition: (metrics) => metrics.roiD0 < 0.05 && metrics.spendUsd > 30,
        action: 'PAUSE_AD',
        params: {},
    },
    // Note: "ROI Drop 3 days" requires historical data comparison which is not available in single-day metrics object.
    // This would need a more complex rule engine that queries historical metrics.
];
