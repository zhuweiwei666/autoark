import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import FacebookTokenPage from './pages/FacebookTokenPage'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/fb-token" element={<FacebookTokenPage />} />
        {/* Add other routes here */}
      </Routes>
    </Router>
  )
}

export default App

