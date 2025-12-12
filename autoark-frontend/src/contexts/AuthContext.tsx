import React, { createContext, useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface User {
  _id: string
  username: string
  email: string
  role: 'super_admin' | 'org_admin' | 'member'
  organizationId?: string
  status: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  isLoading: boolean
  isSuperAdmin: boolean
  isOrgAdmin: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // 从 localStorage 加载用户信息
  useEffect(() => {
    const loadUser = async () => {
      const storedToken = localStorage.getItem('auth_token')
      const storedUser = localStorage.getItem('auth_user')

      if (storedToken && storedUser) {
        setToken(storedToken)
        setUser(JSON.parse(storedUser))
        
        // 验证 token 是否仍然有效
        try {
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${storedToken}`,
            },
          })
          
          if (!response.ok) {
            // 只有在明确未授权时才清除（避免服务重启/临时 5xx 导致“看起来像数据丢失”）
            if (response.status === 401 || response.status === 403) {
              localStorage.removeItem('auth_token')
              localStorage.removeItem('auth_user')
              setToken(null)
              setUser(null)
            } else {
              console.warn('验证用户失败（非 401/403），保留本地登录态以便重试:', response.status)
            }
          } else {
            const data = await response.json()
            setUser(data.data)
            localStorage.setItem('auth_user', JSON.stringify(data.data))
          }
        } catch (error) {
          // 网络/临时错误：不要清空 token，避免用户被动登出
          console.error('验证用户失败（网络或临时错误），保留本地登录态:', error)
        }
      }
      
      setIsLoading(false)
    }

    loadUser()
  }, [])

  const login = async (username: string, password: string) => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || '登录失败')
      }

      setToken(data.data.token)
      setUser(data.data.user)
      localStorage.setItem('auth_token', data.data.token)
      localStorage.setItem('auth_user', JSON.stringify(data.data.user))

      navigate('/dashboard')
    } catch (error: any) {
      throw new Error(error.message || '登录失败')
    }
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    navigate('/login')
  }

  const value: AuthContextType = {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!token && !!user,
    isLoading,
    isSuperAdmin: user?.role === 'super_admin',
    isOrgAdmin: user?.role === 'org_admin',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
