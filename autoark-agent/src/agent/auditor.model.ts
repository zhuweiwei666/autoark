/**
 * Auditor 数据模型 — 审查报告 + 审查发现 + 纠正指令
 */
import mongoose from 'mongoose'

const auditFindingSchema = new mongoose.Schema({
  type: { type: String, enum: ['screener_miss', 'screener_overalert', 'decision_wrong', 'decision_correct', 'executor_fail', 'executor_ok'], required: true },
  campaignId: String,
  campaignName: String,
  skillName: String,
  detail: String,
  severity: { type: String, enum: ['high', 'medium', 'low'], default: 'low' },
  suggestion: String,
}, { _id: false })

const auditReportSchema = new mongoose.Schema({
  cycleId: { type: String, index: true },
  auditType: { type: String, enum: ['screener', 'decision', 'executor', 'full'], required: true },
  auditedAt: { type: Date, default: Date.now, index: true },

  screenerAudit: {
    total: { type: Number, default: 0 },
    falseNegatives: { type: Number, default: 0 },
    falsePositives: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    findings: [auditFindingSchema],
  },

  decisionAudit: {
    total: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    unclear: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    findings: [auditFindingSchema],
  },

  executorAudit: {
    total: { type: Number, default: 0 },
    succeeded: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    findings: [auditFindingSchema],
  },

  corrective: [{
    campaignId: String,
    reason: String,
    action: { type: String, enum: ['rescreen', 'override_decision', 'retry_execute'] },
    processed: { type: Boolean, default: false },
  }],

  summary: String,
}, { timestamps: true })

auditReportSchema.index({ auditedAt: -1 })

export const AuditReport = mongoose.model('AuditReport', auditReportSchema)

export interface AuditFinding {
  type: string
  campaignId: string
  campaignName?: string
  skillName?: string
  detail: string
  severity: 'high' | 'medium' | 'low'
  suggestion: string
}
