/**
 * Facebook Graph API 配置
 * 统一管理 Facebook API 版本和基础 URL
 */

// Facebook Graph API 版本 - 统一使用最新稳定版本
export const FB_API_VERSION = 'v21.0'

// Facebook Graph API 基础 URL
export const FB_BASE_URL = 'https://graph.facebook.com'

// 带版本号的完整基础 URL
export const FB_VERSIONED_URL = `${FB_BASE_URL}/${FB_API_VERSION}`

// Facebook OAuth 相关端点
export const FB_OAUTH_URL = `${FB_BASE_URL}/oauth`

// 常用超时设置（毫秒）
export const FB_REQUEST_TIMEOUT = 30000

// API 请求重试配置
export const FB_RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 毫秒
  retryOn: [500, 502, 503, 504], // 对这些状态码重试
}
