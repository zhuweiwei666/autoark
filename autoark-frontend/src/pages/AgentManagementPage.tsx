import { useState } from 'react'

interface Agent {
  id: string
  name: string
  type: string
  status: 'active' | 'inactive' | 'pending'
  description: string
  lastRun?: string
  icon: string
  gradient: string
}

const mockAgents: Agent[] = [
  {
    id: '1',
    name: '广告优化 Agent',
    type: '优化类',
    status: 'active',
    description: '自动分析广告效果并提出优化建议，智能调整出价策略',
    lastRun: '10 分钟前',
    icon: '⚡',
    gradient: 'from-amber-400 to-orange-500',
  },
  {
    id: '2',
    name: '素材生成 Agent',
    type: '创意类',
    status: 'pending',
    description: '基于产品信息和市场趋势自动生成高转化广告素材',
    icon: '🎨',
    gradient: 'from-pink-400 to-rose-500',
  },
  {
    id: '3',
    name: '预算分配 Agent',
    type: '策略类',
    status: 'inactive',
    description: '智能分配广告预算到各个系列，最大化投资回报率',
    icon: '💰',
    gradient: 'from-emerald-400 to-teal-500',
  },
  {
    id: '4',
    name: '受众洞察 Agent',
    type: '分析类',
    status: 'pending',
    description: '深度分析受众特征和行为，发现高价值用户群体',
    icon: '🎯',
    gradient: 'from-violet-400 to-purple-500',
  },
]

export default function AgentManagementPage() {
  const [agents] = useState<Agent[]>(mockAgents)

  const getStatusConfig = (status: Agent['status']) => {
    const configs = {
      active: { 
        bg: 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20', 
        text: 'text-emerald-700',
        dot: 'bg-emerald-500',
        label: '运行中' 
      },
      inactive: { 
        bg: 'bg-slate-100/80', 
        text: 'text-slate-500',
        dot: 'bg-slate-400',
        label: '已停用' 
      },
      pending: { 
        bg: 'bg-gradient-to-r from-amber-500/20 to-orange-500/20', 
        text: 'text-amber-700',
        dot: 'bg-amber-500',
        label: '待配置' 
      },
    }
    return configs[status]
  }

  return (
    <div className="h-full bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* 页面头部 - 液态玻璃风格 */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 flex items-center justify-center shadow-2xl shadow-purple-500/30 backdrop-blur-xl">
              <span className="text-3xl">🧠</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
                Agent 管理中心
              </h1>
              <p className="text-slate-500 mt-1 font-medium">配置和管理 AI Agent，实现广告自动化运营</p>
            </div>
          </div>
          <button className="
            px-6 py-3 rounded-2xl font-semibold text-white text-sm
            bg-gradient-to-r from-violet-500 to-purple-600 
            hover:from-violet-600 hover:to-purple-700
            shadow-xl shadow-purple-500/25 hover:shadow-purple-500/40
            transition-all duration-300 hover:scale-105
            flex items-center gap-2 backdrop-blur-sm
          ">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            创建 Agent
          </button>
        </div>

        {/* Agent 卡片网格 */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {agents.map((agent) => {
            const statusConfig = getStatusConfig(agent.status)
            return (
              <div 
                key={agent.id} 
                className="
                  group relative overflow-hidden
                  backdrop-blur-xl bg-white/60 
                  rounded-3xl p-6
                  border border-white/60
                  shadow-xl shadow-slate-200/50
                  hover:shadow-2xl hover:shadow-slate-300/50
                  hover:bg-white/80
                  transition-all duration-500 hover:scale-[1.02]
                "
              >
                {/* 背景装饰 */}
                <div className={`absolute -top-20 -right-20 w-40 h-40 rounded-full bg-gradient-to-br ${agent.gradient} opacity-10 blur-3xl group-hover:opacity-20 transition-opacity duration-500`}></div>
                
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${agent.gradient} flex items-center justify-center shadow-lg shadow-slate-300/50`}>
                        <span className="text-2xl">{agent.icon}</span>
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">{agent.name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.text} backdrop-blur-sm`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot} ${agent.status === 'active' ? 'animate-pulse' : ''}`}></span>
                            {statusConfig.label}
                          </span>
                          <span className="text-xs px-2 py-1 rounded-lg bg-slate-100/80 text-slate-500 font-medium">
                            {agent.type}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <p className="text-sm text-slate-600 mb-4 leading-relaxed">{agent.description}</p>
                  
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                    {agent.lastRun ? (
                      <span className="text-xs text-slate-400 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        上次运行: {agent.lastRun}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">尚未运行</span>
                    )}
                    <div className="flex items-center gap-2">
                      <button className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white/80 rounded-xl transition-all duration-200 backdrop-blur-sm">
                        配置
                      </button>
                      <button className={`
                        px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200
                        ${agent.status === 'active' 
                          ? 'bg-gradient-to-r from-slate-100 to-slate-200 text-slate-600 hover:from-slate-200 hover:to-slate-300' 
                          : `bg-gradient-to-r ${agent.gradient} text-white shadow-lg hover:shadow-xl hover:scale-105`
                        }
                      `}>
                        {agent.status === 'active' ? '暂停' : '启动'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* 底部提示 - 液态玻璃风格 */}
        <div className="backdrop-blur-xl bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-indigo-500/10 rounded-3xl p-6 border border-purple-200/50 shadow-xl shadow-purple-100/50">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/30 flex-shrink-0">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <h4 className="font-bold text-slate-800 text-lg mb-1">AI Agent 即将上线</h4>
              <p className="text-slate-600 leading-relaxed">
                我们正在开发强大的 AI Agent 系统，将帮助您自动化广告投放的每个环节。
                包括智能出价、创意生成、效果分析、预算优化等功能，敬请期待！
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
