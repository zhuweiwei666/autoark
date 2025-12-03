import mongoose from 'mongoose'

// 主连接（写操作）
let writeConnection: typeof mongoose | null = null

// 从连接（读操作，用于读写分离）
let readConnection: typeof mongoose | null = null

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || ''
    if (!uri) {
      throw new Error('MONGO_URI is not defined in environment variables')
    }

    // 主连接（写操作）
    writeConnection = await mongoose.connect(uri, {
      readPreference: 'primary', // 主节点用于写操作
    })
    console.log(`MongoDB Connected (Write): ${writeConnection.connection.host}`)

    // 如果配置了读连接 URI，创建独立的读连接
    const readUri = process.env.MONGO_READ_URI
    if (readUri) {
      readConnection = await mongoose.createConnection(readUri, {
        readPreference: 'secondary', // 从节点用于读操作
      })
      console.log(`MongoDB Connected (Read): ${readConnection.connection.host}`)
    } else {
      // 如果没有配置读连接，使用主连接但设置读偏好为 secondaryPreferred
      // 这样会优先使用从节点，如果从节点不可用则使用主节点
      mongoose.connection.on('connected', () => {
        mongoose.set('readPreference', 'secondaryPreferred')
      })
      console.log(`MongoDB Read Preference: secondaryPreferred (using same connection)`)
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`)
    process.exit(1)
  }
}

// 获取读连接（用于查询操作）
export const getReadConnection = () => {
  if (readConnection) {
    return readConnection
  }
  // 如果没有独立的读连接，返回主连接
  return mongoose
}

// 获取写连接（用于写操作）
export const getWriteConnection = () => {
  return mongoose
}

export default connectDB

