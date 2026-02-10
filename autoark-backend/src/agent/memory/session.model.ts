/**
 * Agent Session Model
 * 
 * Tracks each agent run session:
 * - Conversation history (messages + tool calls)
 * - Run metadata (duration, iterations, status)
 * - Summary and decisions made
 * 
 * Used for: debugging, audit trail, resuming conversations.
 */

import mongoose from 'mongoose'

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // who triggered it

    // What kind of session
    triggerType: {
      type: String,
      enum: ['user_chat', 'scheduled_run', 'api_trigger', 'orchestrator'],
      required: true,
    },

    // Role of the agent in this session
    agentRole: {
      type: String,
      enum: ['planner', 'analyst', 'executor', 'creative', 'orchestrator'],
      required: true,
    },

    // Run result
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'needs_approval', 'max_iterations', 'cancelled'],
      default: 'running',
    },

    // Summary of what the agent did (LLM-generated)
    summary: { type: String },

    // Conversation history (stored as JSON for flexibility)
    // Each entry: { role, parts, timestamp }
    messages: [{ type: mongoose.Schema.Types.Mixed }],

    // Tool calls made during this session
    toolCalls: [{
      toolName: String,
      args: mongoose.Schema.Types.Mixed,
      result: mongoose.Schema.Types.Mixed,
      approved: Boolean,
      durationMs: Number,
      timestamp: Date,
    }],

    // IDs of decisions made during this session
    decisionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AgentDecision' }],

    // Performance metrics
    totalIterations: { type: Number, default: 0 },
    totalToolCalls: { type: Number, default: 0 },
    durationMs: { type: Number },

    // Error info (if failed)
    error: { type: String },

    // Input context (what was the user's request or scheduled task)
    inputContext: { type: String },

    // Parent session (if this was spawned by orchestrator)
    parentSessionId: { type: String },
  },
  { timestamps: true }
)

// Indexes for efficient queries
sessionSchema.index({ agentId: 1, createdAt: -1 })
sessionSchema.index({ organizationId: 1, createdAt: -1 })
sessionSchema.index({ status: 1, createdAt: -1 })

export const Session = mongoose.model('AgentSession', sessionSchema)
export default Session
