import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { getAccounts, getCampaigns, getCountries, getMaterialRankings } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const { user, logout, isSuperAdmin, isOrgAdmin } = useAuth()
  
  // 菜单折叠状态
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    data: true,      // 数据资产默认展开
    publish: true,   // 广告发布默认展开
    ai: false,       // AI Agent 默认折叠
    system: false,   // 系统管理默认折叠
  })

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const isActive = (path: string) => {
    return location.pathname === path
  }

  // 预加载数据的配置（仅在无缓存时才会请求）
  const prefetchConfig: Record<string, () => void> = {
    '/fb-accounts': () => {
      queryClient.prefetchQuery({
        queryKey: ['accounts', { page: 1, limit: 20, sortBy: 'periodSpend', sortOrder: 'desc' }],
        queryFn: () => getAccounts({ page: 1, limit: 20, sortBy: 'periodSpend', sortOrder: 'desc' }),
      })
    },
    '/fb-campaigns': () => {
      queryClient.prefetchQuery({
        queryKey: ['campaigns', { page: 1, limit: 20, sortBy: 'spend', sortOrder: 'desc' }],
        queryFn: () => getCampaigns({ page: 1, limit: 20, sortBy: 'spend', sortOrder: 'desc' }),
      })
    },
    '/fb-countries': () => {
      queryClient.prefetchQuery({
        queryKey: ['countries', { page: 1, limit: 20, sortBy: 'spend', sortOrder: 'desc' }],
        queryFn: () => getCountries({ page: 1, limit: 20, sortBy: 'spend', sortOrder: 'desc' }),
      })
    },
    '/fb-materials': () => {
      queryClient.prefetchQuery({
        queryKey: ['materialRankings', {}],
        queryFn: () => getMaterialRankings({}),
      })
    },
  }

  // 菜单项组件 - 液态玻璃风格（带预加载）
  const MenuItem = ({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) => {
    const active = isActive(to)
    
    const handleMouseEnter = () => {
      // 在 hover 时预加载数据
      const prefetch = prefetchConfig[to]
      if (prefetch) {
        prefetch()
      }
    }
    
    return (
      <Link
        to={to}
        onMouseEnter={handleMouseEnter}
        className={`
          menu-item w-full px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-3
          transition-all duration-300 ease-out
          ${active
            ? 'bg-white/90 backdrop-blur-xl shadow-lg shadow-blue-500/10 text-slate-900 border border-white/60 scale-[1.02]'
            : 'text-slate-600 hover:text-slate-900 hover:bg-white/50 hover:backdrop-blur-sm hover:scale-[1.01]'
          }
        `}
      >
        <span className={`transition-all duration-300 ${active ? 'text-blue-500 scale-110' : 'group-hover:scale-105'}`}>{icon}</span>
        <span className="relative">
          {label}
          {active && <span className="absolute -bottom-0.5 left-0 w-full h-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full" />}
        </span>
      </Link>
    )
  }

  // 板块标题组件 - 液态玻璃风格（可折叠）
  const SectionTitle = ({ title, tag, section }: { title: string; tag?: string; section: string }) => {
    const isExpanded = expandedSections[section]
    
    return (
      <button
        onClick={() => toggleSection(section)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 mb-1 mt-4 first:mt-0 rounded-lg hover:bg-white/30 transition-all duration-200 group"
      >
        <div className="flex items-center gap-2">
      {tag && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-blue-500/20 to-cyan-500/20 backdrop-blur-sm text-blue-600 font-semibold border border-blue-200/50">
          {tag}
        </span>
      )}
      <span className="text-xs font-bold uppercase tracking-widest bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">
        {title}
      </span>
    </div>
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24" 
          strokeWidth="2" 
          stroke="currentColor" 
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-blue-50/30 to-indigo-100/50">
      {/* 左侧边栏 - 液态玻璃效果 */}
      <aside className="w-72 backdrop-blur-2xl bg-white/40 border-r border-white/60 flex flex-col shadow-2xl shadow-slate-200/50">
        {/* Logo */}
        <div className="p-6 border-b border-white/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">AutoArk</h1>
              <span className="text-[10px] font-medium text-slate-400 tracking-wider">VERSION 0.1</span>
            </div>
          </div>
        </div>
        
        {/* 菜单项 */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-scroll overscroll-contain scrollbar-thin app-scroll">
          
          {/* ========== 数据资产板块 ========== */}
          <SectionTitle title="数据资产" section="data" />
          
          {expandedSections.data && (
            <div className="space-y-1 animate-accordion-down">
          <MenuItem
            to="/dashboard"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>}
            label="仪表盘"
          />
          <MenuItem
            to="/fb-accounts"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
            label="账户管理"
          />
          <MenuItem
            to="/fb-countries"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>}
            label="国家"
          />
          <MenuItem
            to="/fb-campaigns"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>}
            label="广告系列"
          />
          <MenuItem
            to="/fb-materials"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>}
            label="素材数据"
          />
          <MenuItem
            to="/fb-settings"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
            label="Token & 像素"
          />
          <MenuItem
            to="/fb-apps"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>}
            label="App 管理"
          />
            </div>
          )}

          {/* ========== 广告发布板块 ========== */}
          <SectionTitle title="广告发布" tag="批量" section="publish" />
          
          {expandedSections.publish && (
            <div className="space-y-1 animate-accordion-down">
          <MenuItem
            to="/bulk-ad/create"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>}
            label="创建广告"
          />
          <MenuItem
            to="/bulk-ad/tasks"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>}
            label="任务管理"
          />
          <MenuItem
            to="/bulk-ad/review"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>}
            label="审核状态"
          />
          <MenuItem
            to="/bulk-ad/assets"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>}
            label="资产管理"
          />
          <MenuItem
            to="/bulk-ad/materials"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>}
            label="素材库"
          />
            </div>
          )}

          {/* ========== AI Agent板块 ========== */}
          <SectionTitle title="AI Agent" section="ai" />
          
          {expandedSections.ai && (
            <div className="space-y-1 animate-accordion-down">
          <MenuItem
            to="/ai/agents"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" /></svg>}
            label="Agent管理"
          />
          <MenuItem
            to="/ai/automation-jobs"
            icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.425c0 .414-.336.75-.75.75H4.5a.75.75 0 01-.75-.75V5.425c0-.414.336-.75.75-.75h7.5m8.25 9.475l-3-3m3 3l-3 3m3-3H13.5" /></svg>}
            label="自动化任务"
          />
            </div>
          )}

          {/* ========== 系统管理板块 ========== */}
          {(isSuperAdmin || isOrgAdmin) && (
            <>
              <SectionTitle title="系统管理" section="system" />
              
              {expandedSections.system && (
                <div className="space-y-1 animate-accordion-down">
              <MenuItem
                to="/users"
                icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
                label="用户管理"
              />
              
              {isSuperAdmin && (
                <>
                  <MenuItem
                    to="/organizations"
                    icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>}
                    label="组织管理"
                  />
                  <MenuItem
                    to="/account-pool"
                    icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>}
                    label="账户池"
                  />
                </>
                  )}
                </div>
              )}
            </>
          )}

        </nav>
        
        {/* User Info & Logout - 液态玻璃风格 */}
        <div className="p-4 border-t border-white/40 space-y-3">
          {/* User Info */}
          <div className="px-3 py-2 rounded-xl bg-white/50 backdrop-blur-sm border border-white/60">
            <div className="text-xs font-medium text-gray-700 mb-1">{user?.username}</div>
            <div className="text-[10px] text-gray-500">{user?.email}</div>
            <div className="mt-1">
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                {user?.role === 'super_admin' ? '超级管理员' : user?.role === 'org_admin' ? '组织管理员' : '普通成员'}
              </span>
            </div>
          </div>
          
          {/* Logout Button */}
          <button
            onClick={logout}
            className="w-full px-4 py-2 rounded-xl text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 transition-all duration-200 flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            登出
          </button>
          
          {/* Health Badge */}
          <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-emerald-500/10 to-teal-500/10 backdrop-blur-sm border border-emerald-200/50">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-lg shadow-emerald-500/50"></span>
            <span className="text-xs font-medium text-emerald-700">系统运行正常</span>
          </div>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-scroll overscroll-contain app-scroll">
          <div key={location.pathname} className="animate-fade-in">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
