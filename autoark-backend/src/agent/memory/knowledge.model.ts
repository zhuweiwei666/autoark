/**
 * Knowledge Base Model
 * 
 * Stores learned knowledge that the agent accumulates over time:
 * - What creative styles work for which products
 * - Which audiences convert best for which verticals
 * - Campaign structure patterns that produce good ROAS
 * - Market/seasonal insights
 * 
 * Used for: RAG retrieval during planning, informing strategy decisions.
 */

import mongoose from 'mongoose'

const knowledgeSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },

    // Classification
    category: {
      type: String,
      enum: ['product', 'audience', 'creative', 'campaign_strategy', 'market', 'general'],
      required: true,
      index: true,
    },

    // Key for deduplication and retrieval
    key: { type: String, required: true },

    // The actual knowledge content (natural language)
    content: { type: String, required: true },

    // How confident we are (0-1). Decays over time, increases with revalidation.
    confidence: { type: Number, default: 0.5, min: 0, max: 1 },

    // How this knowledge was acquired
    source: {
      type: String,
      enum: ['agent_learning', 'user_input', 'data_analysis', 'outcome_evaluation'],
      required: true,
    },

    // Related entities for retrieval
    relatedEntities: [{ type: String }], // accountIds, campaignIds, materialIds, etc.
    tags: [{ type: String }], // free-form tags for search

    // Validation tracking
    validationCount: { type: Number, default: 1 }, // how many times this has been confirmed
    lastValidatedAt: { type: Date },

    // Embedding for semantic search (future: vector search)
    // embedding: [{ type: Number }],
  },
  { timestamps: true }
)

// Compound indexes
knowledgeSchema.index({ organizationId: 1, category: 1 })
knowledgeSchema.index({ key: 1, organizationId: 1 }, { unique: true })
knowledgeSchema.index({ tags: 1 })
knowledgeSchema.index({ confidence: -1 })

export const Knowledge = mongoose.model('AgentKnowledge', knowledgeSchema)
export default Knowledge
