import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import FacebookTokenPage from './pages/FacebookTokenPage'
import FacebookAccountsPage from './pages/FacebookAccountsPage'
import FacebookCampaignsPage from './pages/FacebookCampaignsPage' // New: Campaign management page
import FacebookCountriesPage from './pages/FacebookCountriesPage' // New: Country management page
import FacebookPixelsPage from './pages/FacebookPixelsPage' // New: Pixel management page

function App() {
  return (
    <Router>
      <Layout>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fb-token" element={<FacebookTokenPage />} />
          <Route path="/fb-accounts" element={<FacebookAccountsPage />} />
          <Route path="/fb-countries" element={<FacebookCountriesPage />} /> {/* New: Country management route */}
          <Route path="/fb-campaigns" element={<FacebookCampaignsPage />} /> {/* New: Campaign management route */}
          <Route path="/fb-pixels" element={<FacebookPixelsPage />} /> {/* New: Pixel management route */}
          <Route path="/" element={<DashboardPage />} />
        </Routes>
      </Layout>
    </Router>
  )
}

export default App

