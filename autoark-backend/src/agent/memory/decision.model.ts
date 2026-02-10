/**
 * Decision History Model
 * 
 * Records every agent decision with:
 * - What was decided (action, entity, parameters)
 * - Why (reasoning from LLM)
 * - What happened (outcome metrics after N hours/days)
 * 
 * Used for: learning from past decisions, avoiding repeated mistakes,
 * building knowledge about what works.
 */

import mongoose from 'mongoose'

const decisionSchema = new mongoose.Schema(
  {
    agentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    sessionId: { type: String, required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },

    // What was decided
    toolName: { type: String, required: true },
    action: { type: String, required: true, index: true }, // e.g. 'pause_campaign', 'increase_budget'
    entityType: { type: String, required: true }, // 'campaign', 'adset', 'ad'
    entityId: { type: String, required: true, index: true },
    platform: { type: String, enum: ['facebook', 'tiktok'], required: true },

    // Why
    reason: { type: String, required: true },
    confidence: { type: Number, min: 0, max: 1 }, // LLM's confidence

    // Input and output
    input: { type: mongoose.Schema.Types.Mixed, required: true },
    output: { type: mongoose.Schema.Types.Mixed, required: true },

    // Outcome (filled later by evaluation cron)
    outcome: {
      evaluatedAt: Date,
      metricsBefore: { type: mongoose.Schema.Types.Mixed }, // { spend, roas, ctr, cpa, ... }
      metricsAfter: { type: mongoose.Schema.Types.Mixed },
      assessment: { type: String, enum: ['positive', 'negative', 'neutral'] },
      notes: String,
    },

    // Status
    status: {
      type: String,
      enum: ['executed', 'pending_approval', 'approved', 'rejected', 'failed', 'rolled_back'],
      default: 'executed',
    },
  },
  { timestamps: true }
)

// Compound indexes for efficient queries
decisionSchema.index({ agentId: 1, createdAt: -1 })
decisionSchema.index({ entityId: 1, action: 1, createdAt: -1 })
decisionSchema.index({ organizationId: 1, createdAt: -1 })
decisionSchema.index({ 'outcome.assessment': 1, action: 1 })

export const Decision = mongoose.model('AgentDecision', decisionSchema)
export default Decision
