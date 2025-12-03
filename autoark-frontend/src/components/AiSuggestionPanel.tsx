
export interface AiSuggestion {
  analysis: string
  strategy: 'GROWTH' | 'PROFIT' | 'MAINTAIN'
  suggestedTargetRoas?: number
  suggestedBudgetMultiplier?: number
  reasoning: string
  updatedAt?: string
}

interface AiSuggestionPanelProps {
  suggestion?: AiSuggestion
  loading?: boolean
}

export default function AiSuggestionPanel({ suggestion, loading }: AiSuggestionPanelProps) {
  if (loading) {
    return (
      <div className="p-4 bg-slate-50 rounded-xl animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/4 mb-2"></div>
        <div className="h-3 bg-slate-200 rounded w-3/4"></div>
      </div>
    )
  }

  if (!suggestion) {
    return null
  }

  const getStrategyColor = (strategy: string) => {
    switch (strategy) {
      case 'GROWTH': return 'text-emerald-600 bg-emerald-50 border-emerald-200'
      case 'PROFIT': return 'text-amber-600 bg-amber-50 border-amber-200'
      case 'MAINTAIN': return 'text-blue-600 bg-blue-50 border-blue-200'
      default: return 'text-slate-600 bg-slate-50 border-slate-200'
    }
  }

  const getStrategyLabel = (strategy: string) => {
    switch (strategy) {
      case 'GROWTH': return '建议扩量 🚀'
      case 'PROFIT': return '控制成本 💰'
      case 'MAINTAIN': return '维持现状 🛡️'
      default: return strategy
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-1.5 rounded-lg shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h3 className="font-bold text-slate-900">AI 智能分析</h3>
        </div>
        {suggestion.updatedAt && (
          <span className="text-xs text-slate-400">
            更新于 {new Date(suggestion.updatedAt).toLocaleString('zh-CN')}
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* 核心建议 */}
        <div className="flex items-start gap-4">
          <div className={`px-3 py-1 rounded-lg text-xs font-bold border ${getStrategyColor(suggestion.strategy)}`}>
            {getStrategyLabel(suggestion.strategy)}
          </div>
          <div className="flex-1 text-sm text-slate-700 font-medium">
            {suggestion.analysis}
          </div>
        </div>

        {/* 详细理由 */}
        <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 leading-relaxed border border-slate-100">
          {suggestion.reasoning}
        </div>

        {/* 建议参数 */}
        {(suggestion.suggestedTargetRoas || suggestion.suggestedBudgetMultiplier) && (
          <div className="flex gap-4 pt-2 border-t border-slate-100">
            {suggestion.suggestedBudgetMultiplier && (
              <div className="flex-1">
                <div className="text-xs text-slate-500 mb-1">建议预算调整</div>
                <div className="font-mono font-semibold text-slate-900">
                  {suggestion.suggestedBudgetMultiplier > 1 ? '+' : ''}
                  {Math.round((suggestion.suggestedBudgetMultiplier - 1) * 100)}%
                </div>
              </div>
            )}
            {suggestion.suggestedTargetRoas && (
              <div className="flex-1">
                <div className="text-xs text-slate-500 mb-1">建议目标 ROAS</div>
                <div className="font-mono font-semibold text-slate-900">
                  {suggestion.suggestedTargetRoas.toFixed(2)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

