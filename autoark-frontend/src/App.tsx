import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'

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
import DashboardPage from './pages/DashboardPage'
import FacebookTokenPage from './pages/FacebookTokenPage'
import FacebookAccountsPage from './pages/FacebookAccountsPage'
import FacebookCampaignsPage from './pages/FacebookCampaignsPage'
import FacebookCountriesPage from './pages/FacebookCountriesPage'
import FacebookPixelsPage from './pages/FacebookPixelsPage'
import FacebookSettingsPage from './pages/FacebookSettingsPage'
import BulkAdCreatePage from './pages/BulkAdCreatePage'
import TaskManagementPage from './pages/TaskManagementPage'
import AssetManagementPage from './pages/AssetManagementPage'
import MaterialLibraryPage from './pages/MaterialLibraryPage'
import OAuthCallbackPage from './pages/OAuthCallbackPage'
import AIAnalysisPage from './pages/AIAnalysisPage'
import AgentManagementPage from './pages/AgentManagementPage'
import MaterialMetricsPage from './pages/MaterialMetricsPage'
import FacebookAppPage from './pages/FacebookAppPage'
import AdReviewStatusPage from './pages/AdReviewStatusPage'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
        {/* OAuth 回调页面（无 Layout，用于弹窗） */}
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        
        {/* 主应用页面（有 Layout） */}
        <Route path="/*" element={
          <Layout>
            <Routes>
              <Route path="/dashboard" element={<DashboardPage />} />
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
              <Route path="/ai/analysis" element={<AIAnalysisPage />} />
              <Route path="/ai/agents" element={<AgentManagementPage />} />
              <Route path="/" element={<DashboardPage />} />
            </Routes>
          </Layout>
        } />
        </Routes>
      </Router>
    </QueryClientProvider>
  )
}

export default App

