"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeMetrics = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const promptTemplates_1 = require("./promptTemplates");
// Mock LLM Call
const callLLM = async (prompt) => {
    // TODO: Integrate with OpenAI / Groq / Anthropic API
    logger_1.default.info('[AI] Mocking LLM call...');
    // Return a static mock response for now
    const mockResponse = {
        analysis: 'CPI is stable but CTR is slowly declining. ROI D0 is healthy at 25%.',
        reasoning: 'The ad set is profitable, but creative fatigue might be setting in due to lower CTR. Increasing budget slightly to capitalize on current ROI is safe.',
        recommendations: [
            {
                action: 'INCREASE_BUDGET',
                params: { amount: 0.1 },
                confidence: 0.85,
            },
            {
                action: 'CHANGE_CREATIVE',
                params: { tags: ['ugc', 'gameplay_v2'] },
                confidence: 0.6,
            },
        ],
    };
    return JSON.stringify(mockResponse);
};
const analyzeMetrics = async (metrics) => {
    try {
        const metricsString = JSON.stringify(metrics, null, 2);
        const prompt = promptTemplates_1.ANALYZE_ADSET_PROMPT.replace('{{metrics}}', metricsString);
        const rawResponse = await callLLM(prompt);
        // Parse JSON from LLM response (handling potential markdown code blocks if real LLM)
        const jsonStr = rawResponse
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        const result = JSON.parse(jsonStr);
        return result;
    }
    catch (error) {
        logger_1.default.error('[AI Analyzer] Failed to analyze metrics', error);
        return {
            analysis: 'Analysis failed due to internal error.',
            reasoning: 'Error in LLM processing.',
            recommendations: [],
        };
    }
};
exports.analyzeMetrics = analyzeMetrics;
