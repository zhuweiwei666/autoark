import dotenv from 'dotenv'

// 🔥 在应用启动前加载环境变量
dotenv.config()

export const ENV = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL || 'gemini-2.0-flash',
}
