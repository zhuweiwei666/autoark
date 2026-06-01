import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const UserManagementPage = lazy(() => import('./pages/UserManagementPage'))
const OrganizationManagementPage = lazy(() => import('./pages/OrganizationManagementPage'))
const AccountPoolPage = lazy(() => import('./pages/AccountPoolPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const CommercialCenterPage = lazy(() => import('./pages/CommercialCenterPage'))
const AuditLogsPage = lazy(() => import('./pages/AuditLogsPage'))
const FacebookTokenPage = lazy(() => import('./pages/FacebookTokenPage'))
const FacebookAccountsPage = lazy(() => import('./pages/FacebookAccountsPage'))
const FacebookCampaignsPage = lazy(() => import('./pages/FacebookCampaignsPage'))
const FacebookCountriesPage = lazy(() => import('./pages/FacebookCountriesPage'))
const FacebookPixelsPage = lazy(() => import('./pages/FacebookPixelsPage'))
const FacebookSettingsPage = lazy(() => import('./pages/FacebookSettingsPage'))
const BulkAdCreatePage = lazy(() => import('./pages/BulkAdCreatePage'))
const TaskManagementPage = lazy(() => import('./pages/TaskManagementPage'))
const AssetManagementPage = lazy(() => import('./pages/AssetManagementPage'))
const MaterialLibraryPage = lazy(() => import('./pages/MaterialLibraryPage'))
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'))
const AgentManagementPage = lazy(() => import('./pages/AgentManagementPage'))
const MaterialMetricsPage = lazy(() => import('./pages/MaterialMetricsPage'))
const FacebookAppPage = lazy(() => import('./pages/FacebookAppPage'))
const AdReviewStatusPage = lazy(() => import('./pages/AdReviewStatusPage'))
const AutomationJobsPage = lazy(() => import('./pages/AutomationJobsPage'))
const AgentChatPage = lazy(() => import('./pages/AgentChatPage'))

// 创建 QueryClient 实例，配置全局缓存策略
// 策略：显示缓存数据的同时后台刷新（stale-while-revalidate）
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,      // 5分钟内数据视为新鲜，不会触发后台刷新
      gcTime: 1000 * 60 * 30,        // 30分钟后清理未使用的缓存
      refetchOnMount: true,          // 组件挂载时：有缓存先显示，同时后台刷新（如果stale）
      refetchOnWindowFocus: false,   // 窗口聚焦时不自动刷新
      refetchOnReconnect: false,     // 网络重连时不自动刷新
      retry: 1,                      // 失败重试1次
      placeholderData: (previousData: any) => previousData, // 保持之前的数据作为占位
    },
  },
})

const routeFallback = (
  <div className="flex min-h-screen items-center justify-center bg-white text-sm font-semibold text-slate-500">
    加载页面...
  </div>
)

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <Suspense fallback={routeFallback}>
        <Routes>
            {/* 登录页面（无需认证） */}
            <Route path="/login" element={<LoginPage />} />
            
        {/* OAuth 回调页面（无 Layout，用于弹窗） */}
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        
            {/* 主应用页面（需要认证） */}
        <Route path="/*" element={
              <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/commercial" element={<CommercialCenterPage />} />
              <Route path="/fb-accounts" element={<FacebookAccountsPage />} />
              <Route path="/fb-countries" element={<FacebookCountriesPage />} />
              <Route path="/fb-campaigns" element={<FacebookCampaignsPage />} />
              <Route path="/fb-materials" element={<MaterialMetricsPage />} />
              <Route path="/fb-settings" element={<FacebookSettingsPage />} />
              {/* 保留旧路由兼容 */}
              <Route path="/fb-token" element={<FacebookTokenPage />} />
              <Route path="/fb-pixels" element={<FacebookPixelsPage />} />
              <Route path="/fb-apps" element={<FacebookAppPage />} />
              {/* Bulk Ad Creation Routes */}
              <Route path="/bulk-ad/create" element={<BulkAdCreatePage />} />
              <Route path="/bulk-ad/tasks" element={<TaskManagementPage />} />
              <Route path="/bulk-ad/review" element={<AdReviewStatusPage />} />
              <Route path="/bulk-ad/assets" element={<AssetManagementPage />} />
              <Route path="/bulk-ad/targeting" element={<AssetManagementPage />} />
              <Route path="/bulk-ad/copywriting" element={<AssetManagementPage />} />
              <Route path="/bulk-ad/creative" element={<AssetManagementPage />} />
              <Route path="/bulk-ad/materials" element={<MaterialLibraryPage />} />
              {/* AI Agent Routes */}
              <Route path="/ai/chat" element={<AgentChatPage />} />
              <Route path="/ai/agents" element={<AgentManagementPage />} />
              <Route path="/ai/automation-jobs" element={<AutomationJobsPage />} />
                    {/* 用户和组织管理 */}
                    <Route path="/users" element={<UserManagementPage />} />
                    <Route path="/audit-logs" element={
                      <ProtectedRoute requireRole="org_admin">
                        <AuditLogsPage />
                      </ProtectedRoute>
                    } />
                    <Route path="/organizations" element={
                      <ProtectedRoute requireRole="super_admin">
                        <OrganizationManagementPage />
                      </ProtectedRoute>
                    } />
                    <Route path="/account-pool" element={
                      <ProtectedRoute requireRole="super_admin">
                        <AccountPoolPage />
                      </ProtectedRoute>
                    } />
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Layout>
              </ProtectedRoute>
        } />
        </Routes>
          </Suspense>
        </AuthProvider>
      </Router>
    </QueryClientProvider>
  )
}

export default App
