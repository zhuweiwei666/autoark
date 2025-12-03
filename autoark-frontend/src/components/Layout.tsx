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

