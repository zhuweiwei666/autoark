import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'
import FacebookTokenPage from './pages/FacebookTokenPage'

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-950">
        <nav className="border-b border-slate-800 bg-slate-900/50">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center gap-6">
              <Link
                to="/fb-token"
                className="text-slate-300 hover:text-slate-100 transition-colors"
              >
                Facebook Token 管理
              </Link>
            </div>
          </div>
        </nav>
        <Routes>
          <Route path="/fb-token" element={<FacebookTokenPage />} />
          <Route path="/" element={<FacebookTokenPage />} />
        </Routes>
      </div>
    </Router>
  )
}

export default App

