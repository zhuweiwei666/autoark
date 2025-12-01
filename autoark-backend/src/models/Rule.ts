import mongoose from 'mongoose'

const ruleSchema = new mongoose.Schema({
  name: String,
  channel: String,
  platform: String,
  scope: String,
  metric: String,
  operator: String,
  value: Number,
})

export default mongoose.model('Rule', ruleSchema)
