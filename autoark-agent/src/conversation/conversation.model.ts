import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'agent'], required: true },
  content: { type: String, required: true },
  toolCalls: [{ name: String, args: mongoose.Schema.Types.Mixed, result: mongoose.Schema.Types.Mixed }],
  actionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Action' }],
  timestamp: { type: Date, default: Date.now },
})

const conversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, default: 'New conversation' },
  messages: [messageSchema],
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true })

export const Conversation = mongoose.model('Conversation', conversationSchema)
