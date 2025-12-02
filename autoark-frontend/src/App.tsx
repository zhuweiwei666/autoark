import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import FacebookTokenPage from './pages/FacebookTokenPage'
import FacebookAccountsPage from './pages/FacebookAccountsPage'
import FacebookCampaignsPage from './pages/FacebookCampaignsPage' // New: Campaign management page

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-white">
        <Routes>
          <Route path="/fb-token" element={<FacebookTokenPage />} />
          <Route path="/fb-accounts" element={<FacebookAccountsPage />} />
          <Route path="/fb-campaigns" element={<FacebookCampaignsPage />} /> {/* New: Campaign management route */}
          <Route path="/" element={<FacebookTokenPage />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App

