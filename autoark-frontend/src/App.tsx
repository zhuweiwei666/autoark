import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import FacebookTokenPage from './pages/FacebookTokenPage'
import FacebookAccountsPage from './pages/FacebookAccountsPage'
import FacebookCampaignsPage from './pages/FacebookCampaignsPage'
import FacebookCountriesPage from './pages/FacebookCountriesPage'
import FacebookPixelsPage from './pages/FacebookPixelsPage'
import BulkAdCreatePage from './pages/BulkAdCreatePage'
import TaskManagementPage from './pages/TaskManagementPage'
import AssetManagementPage from './pages/AssetManagementPage'

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fb-token" element={<FacebookTokenPage />} />
          <Route path="/fb-accounts" element={<FacebookAccountsPage />} />
          <Route path="/fb-countries" element={<FacebookCountriesPage />} />
          <Route path="/fb-campaigns" element={<FacebookCampaignsPage />} />
          <Route path="/fb-pixels" element={<FacebookPixelsPage />} />
          {/* Bulk Ad Creation Routes */}
          <Route path="/bulk-ad/create" element={<BulkAdCreatePage />} />
          <Route path="/bulk-ad/tasks" element={<TaskManagementPage />} />
          <Route path="/bulk-ad/assets" element={<AssetManagementPage />} />
          <Route path="/bulk-ad/targeting" element={<AssetManagementPage />} />
          <Route path="/bulk-ad/copywriting" element={<AssetManagementPage />} />
          <Route path="/bulk-ad/creative" element={<AssetManagementPage />} />
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App

