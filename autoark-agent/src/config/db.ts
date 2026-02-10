import mongoose from 'mongoose'
import { env } from './env'
import { log } from '../platform/logger'

export async function connectDB() {
  try {
    await mongoose.connect(env.MONGO_URI)
    log.info(`MongoDB connected: ${env.MONGO_URI.replace(/\/\/.*@/, '//***@')}`)
  } catch (err: any) {
    log.error('MongoDB connection failed:', err.message)
    process.exit(1)
  }
}
