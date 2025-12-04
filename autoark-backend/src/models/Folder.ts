import mongoose, { Schema, Document } from 'mongoose'

export interface IFolder extends Document {
  name: string
  parentId: mongoose.Types.ObjectId | null  // 父文件夹 ID，null 表示根目录
  path: string  // 完整路径，如 "产品图/Banner"
  level: number  // 层级深度，0 表示根目录
  createdAt: Date
  updatedAt: Date
}

const folderSchema = new Schema<IFolder>({
  name: { 
    type: String, 
    required: true,
    trim: true,
  },
  parentId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Folder',
    default: null,
  },
  path: { 
    type: String, 
    required: true,
    index: true,
  },
  level: { 
    type: Number, 
    default: 0,
  },
}, {
  timestamps: true,
})

// 复合索引：同一父目录下名称唯一
folderSchema.index({ parentId: 1, name: 1 }, { unique: true })

export default mongoose.model<IFolder>('Folder', folderSchema)

