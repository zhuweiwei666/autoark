import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const formatOAuthError = (rawError: string) => {
  const decoded = safeDecode(rawError)
  if (decoded.includes('Invalid OAuth state') || decoded.includes('Missing OAuth state')) {
    return '授权链接已失效或来源不匹配，请回到 AutoArk 重新点击 Facebook 登录。'
  }
  if (decoded.includes('No authorization code')) {
    return 'Facebook 未返回授权码，请关闭窗口后重新发起授权。'
  }
  return decoded
}

const OAuthCallbackPage = () => {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')
    const tokenId = searchParams.get('token_id')
    const fbUserName = searchParams.get('fb_user_name')

    if (oauthSuccess === 'true') {
      setStatus('success')
      setMessage(`授权成功${fbUserName ? ` - ${safeDecode(fbUserName)}` : ''}`)
      
      if (window.opener) {
        const targetOrigin = window.location.origin
        window.opener.postMessage({
          type: 'oauth-success',
          tokenId,
          fbUserName: fbUserName ? safeDecode(fbUserName) : undefined,
        }, targetOrigin)
        setTimeout(() => window.close(), 1500)
      } else {
        setTimeout(() => { window.location.href = '/bulk-ad/create' }, 1500)
      }
    } else if (oauthError) {
      const friendlyError = formatOAuthError(oauthError)
      setStatus('error')
      setMessage(friendlyError)
      
      if (window.opener) {
        window.opener.postMessage({ type: 'oauth-error', error: friendlyError }, window.location.origin)
        setTimeout(() => window.close(), 3000)
      }
    } else {
      setStatus('error')
      setMessage('未知的回调参数')
    }
  }, [searchParams])

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: status === 'success' ? '#f0fdf4' : status === 'error' ? '#fef2f2' : '#f5f5f5',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '20px',
    },
    spinner: {
      width: 48,
      height: 48,
      border: '4px solid #e5e7eb',
      borderTopColor: '#3b82f6',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
    },
    iconSuccess: {
      width: 64,
      height: 64,
      backgroundColor: '#22c55e',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconError: {
      width: 64,
      height: 64,
      backgroundColor: '#ef4444',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  }

  return (
    <div style={styles.container}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      
      {status === 'processing' && (
        <>
          <div style={styles.spinner} />
          <p style={{ marginTop: 16, color: '#6b7280', fontSize: 16 }}>处理中...</p>
        </>
      )}
      
      {status === 'success' && (
        <>
          <div style={styles.iconSuccess}>
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 style={{ marginTop: 16, color: '#16a34a', fontSize: 24, fontWeight: 600 }}>授权成功!</h2>
          <p style={{ marginTop: 8, color: '#6b7280', fontSize: 14 }}>{message}</p>
          <p style={{ marginTop: 16, color: '#9ca3af', fontSize: 12 }}>窗口将自动关闭...</p>
        </>
      )}
      
      {status === 'error' && (
        <>
          <div style={styles.iconError}>
            <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 style={{ marginTop: 16, color: '#dc2626', fontSize: 24, fontWeight: 600 }}>授权失败</h2>
          <p style={{ marginTop: 8, color: '#6b7280', fontSize: 14, textAlign: 'center', maxWidth: 300 }}>{message}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button onClick={() => { window.location.href = '/bulk-ad/create' }} style={{ padding: '10px 18px', backgroundColor: '#111827', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
              返回创建广告
            </button>
            <button onClick={() => window.close()} style={{ padding: '10px 18px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600 }}>
              关闭窗口
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default OAuthCallbackPage
