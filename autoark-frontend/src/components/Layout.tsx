import { Link, useLocation } from 'react-router-dom'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()

  const isActive = (path: string) => {
    return location.pathname === path
  }

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* 左侧边栏菜单 */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-sm">
        {/* Logo */}
        <div className="p-4 border-b border-slate-200">
          <h1 className="text-xl font-bold text-slate-900">AutoArk</h1>
          <span className="text-xs text-slate-600">V0.1</span>
        </div>
        
        {/* 菜单项 */}
        <nav className="flex-1 p-4 space-y-2">
          <Link
            to="/dashboard"
            className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
              isActive('/dashboard') || isActive('/')
                ? 'bg-slate-200 border border-slate-300 text-slate-900'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75h2.25A2.25 2.25 0 018.25 18v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V15.75zM13.5 6h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H13.5A2.25 2.25 0 0111.25 18V8.25a2.25 2.25 0 012.25-2.25z" />
            </svg>
            <span>仪表盘</span>
          </Link>
          <Link
            to="/fb-token"
            className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
              isActive('/fb-token')
                ? 'bg-slate-200 border border-slate-300 text-slate-900'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 9z" />
            </svg>
            <span>Token 管理</span>
          </Link>
          <Link
            to="/fb-accounts"
            className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
              isActive('/fb-accounts')
                ? 'bg-slate-200 border border-slate-300 text-slate-900'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2m16-11V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16M14 10h.01M17 10h.01M9 10h.01M12 10h.01m2 2h.01M17 14h.01M9 14h.01M12 14h.01m2 2h.01M17 18h.01M9 18h.01M12 18h.01m-2-12h.01M7 12h.01m-2-12h.01M17 12h.01M9 12h.01m4-4h.01M7 16h.01M14 16h.01M14 20h.01M7 20h.01M9 16h.01M14 20h.01M7 20h.01" />
            </svg>
            <span>账户管理</span>
          </Link>
          <Link
            to="/fb-countries"
            className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
              isActive('/fb-countries')
                ? 'bg-slate-200 border border-slate-300 text-slate-900'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
            </svg>
            <span>国家</span>
          </Link>
          <Link
            to="/fb-campaigns"
            className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
              isActive('/fb-campaigns')
                ? 'bg-slate-200 border border-slate-300 text-slate-900'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.497l4.875-2.437c.381-.194.62-.57.62-.981V9.75M8.25 19.5l-1.5-1.5m-3.75 3.75h15M11.25 4.5l-1.5-1.5M1.5 13.5l1.5-1.5m1.5 2.25l-1.5-1.5m-1.5 2.25l-1.5-1.5" />
            </svg>
            <span>广告系列</span>
          </Link>
          <Link
            to="/fb-pixels"
            className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
              isActive('/fb-pixels')
                ? 'bg-slate-200 border border-slate-300 text-slate-900'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
            <span>像素</span>
          </Link>
          
          {/* 批量广告发布模块 */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="text-xs text-slate-400 uppercase tracking-wider mb-2 px-4">批量发布</div>
            <Link
              to="/bulk-ad/create"
              className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
                isActive('/bulk-ad/create')
                  ? 'bg-green-100 border border-green-300 text-green-700'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>创建广告</span>
            </Link>
            <Link
              to="/bulk-ad/tasks"
              className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
                isActive('/bulk-ad/tasks')
                  ? 'bg-slate-200 border border-slate-300 text-slate-900'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
              <span>任务管理</span>
            </Link>
            <Link
              to="/bulk-ad/assets"
              className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
                location.pathname.startsWith('/bulk-ad/assets') || 
                location.pathname.startsWith('/bulk-ad/targeting') ||
                location.pathname.startsWith('/bulk-ad/copywriting') ||
                location.pathname.startsWith('/bulk-ad/creative')
                  ? 'bg-slate-200 border border-slate-300 text-slate-900'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <span>资产管理</span>
            </Link>
            <Link
              to="/bulk-ad/materials"
              className={`w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors flex items-center gap-3 ${
                isActive('/bulk-ad/materials')
                  ? 'bg-purple-100 border border-purple-300 text-purple-700'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              <span>素材库</span>
            </Link>
          </div>
        </nav>
        
        {/* Health Badge */}
        <div className="p-4 border-t border-slate-200">
          <span className="text-xs px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 block text-center">Healthy</span>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  )
}

