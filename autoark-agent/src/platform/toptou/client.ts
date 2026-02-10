/**
 * TopTou API Client
 * 通过逆向 TopTou 前端 JS 获取的 API 接口
 * Base: https://toptou.tec-do.com/phoenix/v1.0/
 */
import axios from 'axios'
import { log } from '../logger'

const BASE_URL = 'https://toptou.tec-do.com/phoenix/v1.0'
const AUTH_BASE = 'https://toptou.tec-do.com/auth-user'

let accessToken: string = process.env.TOPTOU_TOKEN || ''

export function setTopTouToken(token: string) {
  accessToken = token
  log.info('[TopTou] Token set')
}

export function getTopTouToken(): string {
  return accessToken
}

async function request(method: 'GET' | 'POST', path: string, data?: any): Promise<any> {
  if (!accessToken) throw new Error('TopTou accessToken not set')
  
  const url = `${BASE_URL}${path}`
  try {
    const res = await axios({
      method, url,
      headers: {
        'Content-Type': 'application/json',
        'accessToken': accessToken,
      },
      data: method === 'POST' ? data : undefined,
      params: method === 'GET' ? data : undefined,
      timeout: 30000,
    })
    
    if (res.data?.code === 20107) {
      throw new Error('TopTou token expired')
    }
    
    return res.data
  } catch (err: any) {
    log.error(`[TopTou] ${method} ${path} failed:`, err.response?.data?.msg || err.message)
    throw err
  }
}

export const toptouClient = {
  get: (path: string, params?: any) => request('GET', path, params),
  post: (path: string, data?: any) => request('POST', path, data),
}
