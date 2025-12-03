import mongoose from 'mongoose'

const aiSuggestionSchema = new mongoose.Schema(
  {
    campaignId: { type: String, required: true, index: true },
    accountId: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    
    // AI 输出
    analysis: String,
    strategy: String,
    reasoning: String,
    suggestedParams: {
      targetRoas: Number,
      budgetCap: Number,
    },
    
    // 状态
    status: { 
      type: String, 
      enum: ['PENDING', 'APPLIED', 'REJECTED', 'IGNORED'], 
      default: 'PENDING' 
    },
    
    // 原始上下文快照
    contextSnapshot: Object,
  },
  { timestamps: true }
)

// 索引：每天每个 Campaign 只需一条建议
aiSuggestionSchema.index({ campaignId: 1, date: 1 }, { unique: true })

export default mongoose.model('AiSuggestion', aiSuggestionSchema)

