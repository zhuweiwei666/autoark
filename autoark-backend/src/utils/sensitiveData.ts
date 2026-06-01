const SENSITIVE_KEYS = new Set([
  'token',
  'accessToken',
  'access_token',
  'appSecret',
  'app_secret',
  'clientSecret',
  'client_secret',
  'secret',
  'password',
  'authorization',
])

const redactString = (value: string) => value
  .replace(/\b(access_token|token|appSecret|app_secret|client_secret|clientSecret|password|authorization)=([^&\s]+)/gi, '$1=[REDACTED]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [REDACTED]')
  .replace(/\bEAA[A-Za-z0-9_-]{12,}/g, '[REDACTED_FB_TOKEN]')

export const redactSensitiveData = (value: any): any => {
  if (value === undefined || value === null) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object') return value
  if (value instanceof Date) return value
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item))

  return Object.entries(value).reduce((acc: Record<string, any>, [key, child]) => {
    acc[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redactSensitiveData(child)
    return acc
  }, {})
}
