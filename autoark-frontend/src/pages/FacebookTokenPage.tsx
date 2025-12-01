import { useState } from 'react'

export default function FacebookTokenPage() {
  const [token, setToken] = useState('')
  const [result, setResult] = useState('')

  const saveToken = async () => {
    setResult('Saving...')
    try {
      const res = await fetch('http://localhost:3001/facebook/save-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      setResult(JSON.stringify(data, null, 2))
    } catch (err) {
      setResult('Error connecting to backend')
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h3>Facebook Token 输入</h3>
      <textarea
        rows={4}
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="粘贴你的 Facebook 长期 Token"
        style={{ width: '100%' }}
      />
      <button
        onClick={saveToken}
        style={{ marginTop: 20, padding: '10px 20px' }}
      >
        保存 Token
      </button>
      <pre style={{ marginTop: 20, background: '#eee', padding: 20 }}>
        {result}
      </pre>
    </div>
  )
}

