import mongoose from 'mongoose'

/**
 * 账户分组模型
 * 用于超级管理员管理和分类大量广告账户
 */

export interface IAccountGroup extends mongoose.Document {
  name: string
  description?: string
  color?: string // 标签颜色
  organizationId?: mongoose.Types.ObjectId // 关联的组织（可选）
  accounts: string[] // 包含的账户ID列表
  createdBy: mongoose.Types.ObjectId
}

const accountGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    color: {
      type: String,
      default: '#3B82F6', // 默认蓝色
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
      // 可选：未分配的账户分组不关联组织
    },
    accounts: [{
      type: String, // Facebook accountId
    }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
)

// 索引
accountGroupSchema.index({ organizationId: 1 })
accountGroupSchema.index({ createdBy: 1 })
accountGroupSchema.index({ 'accounts': 1 })

export default mongoose.model<IAccountGroup>('AccountGroup', accountGroupSchema)
