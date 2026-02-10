const BASE = '/agent'

function getToken() { return localStorage.getItem('token') }

export async function api(path: string, opts: RequestInit = {}) {
  const headers: any = { 'Content-Type': 'application/json', ...opts.headers }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  if (res.status === 401 && !path.includes('/auth/login')) { localStorage.removeItem('token'); window.location.href = '/agent/login' }
  return res.json()
}

export const post = (path: string, body: any) => api(path, { method: 'POST', body: JSON.stringify(body) })
export const get = (path: string) => api(path)
