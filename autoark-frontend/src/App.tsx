import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import FacebookTokenPage from './pages/FacebookTokenPage'
import FacebookAccountsPage from './pages/FacebookAccountsPage'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-950">
        <Routes>
          <Route path="/fb-token" element={<FacebookTokenPage />} />
          <Route path="/fb-accounts" element={<FacebookAccountsPage />} />
          <Route path="/" element={<FacebookTokenPage />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App

