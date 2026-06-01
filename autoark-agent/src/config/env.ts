import dotenv from 'dotenv'
dotenv.config()

const isProduction = process.env.NODE_ENV === 'production'

function required(name: string, fallback = ''): string {
  const value = process.env[name] || fallback
  if (isProduction && !process.env[name]) {
    throw new Error(`${name} must be configured in production`)
  }
  return value
}

function requiredAlways(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be configured`)
  }
  return value
}

function requiredSecret(name: string, fallback = ''): string {
  const value = required(name, fallback)
  if (isProduction && value === 'change-me') {
    throw new Error(`${name} must not use the development default in production`)
  }
  return value
}

export const env = {
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/autoark',
  REDIS_URL: process.env.REDIS_URL || '',
  JWT_SECRET: requiredSecret('JWT_SECRET', 'change-me'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  LLM_API_KEY: process.env.LLM_API_KEY || '',
  LLM_MODEL: process.env.LLM_MODEL || 'claude-opus-4-20250514',
  LLM_BASE_URL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
  LLM_REFLECTION_ENABLED: process.env.LLM_REFLECTION_ENABLED !== 'false',
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID || '',
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET || '',
  FACEBOOK_REDIRECT_URI: process.env.FACEBOOK_REDIRECT_URI || '',
  ADMIN_USERNAME: required('ADMIN_USERNAME', 'admin'),
  ADMIN_PASSWORD: requiredAlways('ADMIN_PASSWORD'),
}
