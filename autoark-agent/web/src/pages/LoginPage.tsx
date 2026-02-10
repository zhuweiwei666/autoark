import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { post } from '../api'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const data = await post('/api/auth/login', { username, password })
      if (data.token) {
        localStorage.setItem('token', data.token)
        navigate('/chat')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch { setError('Network error') }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <form onSubmit={handleLogin} className="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-8 w-96 shadow-2xl">
        <h1 className="text-3xl font-bold text-white text-center mb-2">AutoArk Agent</h1>
        <p className="text-blue-200 text-center text-sm mb-8">AI-Powered Ad Automation</p>
        {error && <div className="bg-red-500/20 text-red-200 text-sm rounded-lg p-3 mb-4">{error}</div>}
        <input
          type="text" value={username} onChange={e => setUsername(e.target.value)}
          placeholder="Username" autoFocus
          className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 mb-3 outline-none focus:border-blue-400"
        />
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 mb-6 outline-none focus:border-blue-400"
        />
        <button
          type="submit" disabled={loading}
          className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  )
}
