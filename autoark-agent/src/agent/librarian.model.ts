/**
 * Librarian 知识库数据模型
 *
 * 五类知识：skill_insight / campaign_pattern / market_knowledge / decision_lesson / user_preference
 * 知识有置信度，随验证增减，长期不验证会衰减。
 */
import mongoose from 'mongoose'

const knowledgeSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ['skill_insight', 'campaign_pattern', 'market_knowledge', 'decision_lesson', 'user_preference'],
    required: true,
    index: true,
  },
  key: { type: String, required: true, unique: true },
  content: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed },
  confidence: { type: Number, default: 0.5, index: true },
  validations: { type: Number, default: 1 },
  source: {
    type: String,
    enum: ['auditor', 'evolution', 'user_feedback', 'llm_synthesis', 'statistical'],
    default: 'auditor',
  },
  relatedSkills: { type: [String], default: [] },
  relatedPackages: { type: [String], default: [] },
  tags: { type: [String], default: [], index: true },
  archived: { type: Boolean, default: false },
  lastValidatedAt: { type: Date, default: Date.now },
}, { timestamps: true })

knowledgeSchema.index({ category: 1, confidence: -1 })
knowledgeSchema.index({ archived: 1 })

export const Knowledge = mongoose.model('Knowledge', knowledgeSchema)
