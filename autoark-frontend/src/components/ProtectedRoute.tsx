import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { PageLoading } from './Loading'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireRole?: 'super_admin' | 'org_admin' | 'member'
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requireRole }) => {
  const { isAuthenticated, isLoading, user } = useAuth()

  if (isLoading) {
    return <PageLoading message="验证身份中..." fullScreen />
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // 检查角色权限
  if (requireRole) {
    const roleHierarchy = {
      super_admin: 3,
      org_admin: 2,
      member: 1,
    }

    const userLevel = roleHierarchy[user?.role || 'member']
    const requiredLevel = roleHierarchy[requireRole]

    if (userLevel < requiredLevel) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">403</h1>
            <p className="text-xl text-gray-600 mb-4">权限不足</p>
            <p className="text-gray-500">您没有访问此页面的权限</p>
          </div>
        </div>
      )
    }
  }

  return <>{children}</>
}

export default ProtectedRoute
