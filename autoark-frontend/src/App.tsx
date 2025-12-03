import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import FacebookTokenPage from './pages/FacebookTokenPage'
import FacebookAccountsPage from './pages/FacebookAccountsPage'
import FacebookCampaignsPage from './pages/FacebookCampaignsPage' // New: Campaign management page

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fb-token" element={<FacebookTokenPage />} />
          <Route path="/fb-accounts" element={<FacebookAccountsPage />} />
          <Route path="/fb-campaigns" element={<FacebookCampaignsPage />} /> {/* New: Campaign management route */}
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App

