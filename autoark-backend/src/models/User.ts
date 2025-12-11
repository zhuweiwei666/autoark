import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

export enum UserRole {
  SUPER_ADMIN = 'super_admin',
  ORG_ADMIN = 'org_admin',
  MEMBER = 'member',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export interface IUser extends mongoose.Document {
  username: string
  password: string
  email: string
  role: UserRole
  organizationId?: mongoose.Types.ObjectId
  status: UserStatus
  lastLoginAt?: Date
  createdBy?: mongoose.Types.ObjectId
  boundAppId?: string // 用户绑定的 Facebook App ID
  comparePassword(candidatePassword: string): Promise<boolean>
}

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 50,
      index: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.MEMBER,
      required: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      index: true,
      // super_admin 不需要 organizationId，其他角色必须有
      required: function(this: IUser) {
        return this.role !== UserRole.SUPER_ADMIN
      },
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
      required: true,
    },
    lastLoginAt: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    boundAppId: {
      type: String, // 用户绑定的 Facebook App ID
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: function(doc, ret) {
        // 不返回密码
        delete ret.password
        return ret
      },
    },
  }
)

// 密码加密中间件
userSchema.pre('save', async function() {
  // 只在密码被修改时才加密
  if (!this.isModified('password')) {
    return
  }

  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)
})

// 比较密码的方法
userSchema.methods.comparePassword = async function(
  candidatePassword: string
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password)
}

// 索引
userSchema.index({ username: 1, email: 1 })
userSchema.index({ organizationId: 1, status: 1 })
userSchema.index({ role: 1 })

export default mongoose.model<IUser>('User', userSchema)
