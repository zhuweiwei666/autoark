import { useState } from 'react'

const analysisCards = [
  {
    id: 'performance',
    title: '广告效果分析',
    description: '深度分析广告投放效果，识别高转化和低效素材',
    icon: '📊',
    gradient: 'from-blue-400 to-cyan-500',
    metrics: ['CTR', 'CVR', 'ROAS', 'CPA'],
  },
  {
    id: 'optimization',
    title: '智能优化建议',
    description: '基于数据驱动的 AI 洞察，生成可执行的优化方案',
    icon: '💡',
    gradient: 'from-amber-400 to-orange-500',
    metrics: ['预算', '出价', '受众', '创意'],
  },
  {
    id: 'prediction',
    title: '趋势预测',
    description: '预测未来广告效果走势，提前把握市场机会',
    icon: '🔮',
    gradient: 'from-violet-400 to-purple-500',
    metrics: ['7日', '14日', '30日', '趋势'],
  },
  {
    id: 'audience',
    title: '受众洞察',
    description: '深入分析目标受众特征，发现高价值用户群体',
    icon: '🎯',
    gradient: 'from-emerald-400 to-teal-500',
    metrics: ['年龄', '兴趣', '地域', '设备'],
  },
]

export default function AIAnalysisPage() {
  const [, setAnalyzing] = useState(false)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)

  return (
    <div className="h-full bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* 页面头部 */}
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500 via-cyan-500 to-teal-500 flex items-center justify-center shadow-2xl shadow-blue-500/30">
              <span className="text-3xl">🤖</span>
            </div>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 bg-clip-text text-transparent">
                AI 智能分析
              </h1>
              <p className="text-slate-500 mt-1 font-medium">利用 AI 深度分析广告数据，获取智能优化建议</p>
            </div>
          </div>
          <button 
            onClick={() => setAnalyzing(true)}
            className="
              px-6 py-3 rounded-2xl font-semibold text-white text-sm
              bg-gradient-to-r from-blue-500 to-cyan-500 
              hover:from-blue-600 hover:to-cyan-600
              shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40
              transition-all duration-300 hover:scale-105
              flex items-center gap-2
            "
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
            </svg>
            开始分析
          </button>
        </div>

        {/* 分析功能卡片 */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {analysisCards.map((card) => (
            <div 
              key={card.id}
              onClick={() => setSelectedCard(card.id)}
              className={`
                group relative overflow-hidden cursor-pointer
                backdrop-blur-xl bg-white/60 
                rounded-3xl p-6
                border-2 transition-all duration-500
                ${selectedCard === card.id 
                  ? 'border-blue-400/50 shadow-2xl shadow-blue-200/50 scale-[1.02]' 
                  : 'border-white/60 shadow-xl shadow-slate-200/50 hover:shadow-2xl hover:shadow-slate-300/50 hover:scale-[1.01]'
                }
              `}
            >
              {/* 背景光效 */}
              <div className={`absolute -top-20 -right-20 w-40 h-40 rounded-full bg-gradient-to-br ${card.gradient} opacity-10 blur-3xl group-hover:opacity-20 transition-opacity duration-500`}></div>
              
              <div className="relative">
                <div className="flex items-start gap-4 mb-4">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shadow-lg`}>
                    <span className="text-2xl">{card.icon}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-slate-800 mb-1">{card.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{card.description}</p>
                  </div>
                </div>
                
                {/* 指标标签 */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-100/80">
                  {card.metrics.map((metric) => (
                    <span 
                      key={metric}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold backdrop-blur-sm bg-gradient-to-r ${card.gradient} bg-opacity-10 text-slate-700`}
                      style={{ background: `linear-gradient(135deg, rgba(0,0,0,0.03), rgba(0,0,0,0.06))` }}
                    >
                      {metric}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 分析仪表盘预览 */}
        <div className="backdrop-blur-xl bg-white/60 rounded-3xl p-8 border border-white/60 shadow-xl shadow-slate-200/50">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-bold text-slate-800">分析仪表盘</h2>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-500/10 to-cyan-500/10 text-blue-600 backdrop-blur-sm">
                实时更新
              </span>
            </div>
          </div>

          {/* 占位内容 */}
          <div className="text-center py-16">
            <div className="relative inline-block">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center mb-6 mx-auto">
                <svg className="w-12 h-12 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              {/* 装饰性光环 */}
              <div className="absolute inset-0 w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-400 to-cyan-400 opacity-20 blur-2xl mx-auto"></div>
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">AI 分析功能开发中</h3>
            <p className="text-slate-500 max-w-md mx-auto leading-relaxed">
              我们正在训练更智能的 AI 模型，即将为您提供强大的广告数据分析和优化建议功能
            </p>
            
            {/* 进度指示器 */}
            <div className="mt-8 max-w-xs mx-auto">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span>开发进度</span>
                <span>65%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-1000"
                  style={{ width: '65%' }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
