import { useState } from 'react'

interface Agent {
  id: string
  name: string
  type: string
  status: 'active' | 'inactive' | 'pending'
  description: string
  lastRun?: string
}

const mockAgents: Agent[] = [
  {
    id: '1',
    name: '广告优化 Agent',
    type: '优化类',
    status: 'active',
    description: '自动分析广告效果并提出优化建议',
    lastRun: '10 分钟前',
  },
  {
    id: '2',
    name: '素材生成 Agent',
    type: '创意类',
    status: 'pending',
    description: '基于产品信息自动生成广告素材',
  },
  {
    id: '3',
    name: '预算分配 Agent',
    type: '策略类',
    status: 'inactive',
    description: '智能分配广告预算到各个系列',
  },
]

export default function AgentManagementPage() {
  const [agents] = useState<Agent[]>(mockAgents)

  const getStatusBadge = (status: Agent['status']) => {
    const styles = {
      active: 'bg-green-100 text-green-700',
      inactive: 'bg-slate-100 text-slate-600',
      pending: 'bg-amber-100 text-amber-700',
    }
    const labels = {
      active: '运行中',
      inactive: '已停用',
      pending: '待配置',
    }
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${styles[status]}`}>
        {labels[status]}
      </span>
    )
  }

  return (
    <div className="h-full bg-gradient-to-br from-slate-50 to-blue-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* 页面标题 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
              <span className="text-3xl">🧠</span>
              Agent 管理
            </h1>
            <p className="text-slate-500 mt-1">配置和管理 AI Agent，实现广告自动化</p>
          </div>
          <button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            创建 Agent
          </button>
        </div>

        {/* Agent 列表 */}
        <div className="space-y-4">
          {agents.map((agent) => (
            <div 
              key={agent.id} 
              className="bg-white rounded-xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-500 rounded-lg flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-slate-900">{agent.name}</h3>
                      {getStatusBadge(agent.status)}
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                        {agent.type}
                      </span>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">{agent.description}</p>
                    {agent.lastRun && (
                      <p className="text-xs text-slate-400 mt-2">上次运行: {agent.lastRun}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                    配置
                  </button>
                  <button className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                    运行
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 提示信息 */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
            </div>
            <div>
              <h4 className="font-medium text-blue-900">Agent 功能开发中</h4>
              <p className="text-sm text-blue-700 mt-1">
                AI Agent 将帮助您自动化广告投放流程，包括智能出价、素材生成、效果分析等功能。敬请期待！
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

