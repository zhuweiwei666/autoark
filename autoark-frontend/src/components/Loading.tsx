import React from 'react'

/**
 * 液态玻璃 Loading 组件系统
 * 统一的加载状态展示
 */

// ==================== 1. 旋转 Spinner ====================
interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  color?: 'blue' | 'white' | 'gray' | 'emerald'
  className?: string
}

export const Spinner: React.FC<SpinnerProps> = ({ 
  size = 'md', 
  color = 'blue',
  className = '' 
}) => {
  const sizeMap = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  }
  
  const colorMap = {
    blue: 'border-blue-200 border-t-blue-600',
    white: 'border-white/30 border-t-white',
    gray: 'border-gray-200 border-t-gray-600',
    emerald: 'border-emerald-200 border-t-emerald-600',
  }
  
  return (
    <div className={`${sizeMap[size]} ${colorMap[color]} border-2 rounded-full animate-spin ${className}`} />
  )
}

// ==================== 2. 液态玻璃加载容器 ====================
interface LoadingOverlayProps {
  message?: string
  size?: 'sm' | 'md' | 'lg'
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ 
  message = '加载中...', 
  size = 'md' 
}) => {
  const sizeConfig = {
    sm: { spinner: 'sm', text: 'text-sm', padding: 'p-4' },
    md: { spinner: 'md', text: 'text-base', padding: 'p-6' },
    lg: { spinner: 'lg', text: 'text-lg', padding: 'p-8' },
  }
  
  const config = sizeConfig[size]
  
  return (
    <div className="flex items-center justify-center py-20">
      <div className={`glass-loading-card ${config.padding} flex flex-col items-center gap-4 animate-fade-in`}>
        <Spinner size={config.spinner as any} color="blue" />
        <p className={`${config.text} text-slate-600 font-medium`}>{message}</p>
      </div>
    </div>
  )
}

// ==================== 3. 内联加载指示器 ====================
interface InlineLoadingProps {
  message?: string
  size?: 'sm' | 'md'
}

export const InlineLoading: React.FC<InlineLoadingProps> = ({ 
  message = '加载中...', 
  size = 'sm' 
}) => {
  return (
    <div className="flex items-center gap-2 text-blue-600">
      <Spinner size={size} color="blue" />
      <span className={`${size === 'sm' ? 'text-xs' : 'text-sm'} font-medium animate-pulse`}>
        {message}
      </span>
    </div>
  )
}

// ==================== 4. 全屏加载遮罩 ====================
interface FullScreenLoadingProps {
  message?: string
  description?: string
  progress?: number // 0-100
}

export const FullScreenLoading: React.FC<FullScreenLoadingProps> = ({ 
  message = '处理中...', 
  description,
  progress 
}) => {
  return (
    <div className="fixed inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-50 animate-fade-in">
      <div className="glass-loading-card p-10 max-w-md w-full mx-4">
        <div className="flex flex-col items-center gap-6">
          {/* 旋转器 */}
          <div className="relative">
            <Spinner size="xl" color="blue" />
            {progress !== undefined && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-blue-600">{Math.round(progress)}%</span>
              </div>
            )}
          </div>
          
          {/* 文字 */}
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold text-slate-900">{message}</h3>
            {description && (
              <p className="text-sm text-slate-500">{description}</p>
            )}
          </div>
          
          {/* 进度条 */}
          {progress !== undefined && (
            <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
              <div 
                className="progress-bar h-full rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ==================== 5. 空状态 ====================
interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export const EmptyState: React.FC<EmptyStateProps> = ({ 
  icon, 
  title, 
  description, 
  action 
}) => {
  return (
    <div className="text-center py-20 px-4">
      <div className="glass-loading-card p-12 max-w-md mx-auto animate-fade-in">
        {icon || (
          <div className="text-6xl mb-4 opacity-30">📊</div>
        )}
        <h3 className="text-xl font-semibold text-slate-700 mb-2">{title}</h3>
        {description && (
          <p className="text-slate-500 mb-6">{description}</p>
        )}
        {action && (
          <button
            onClick={action.onClick}
            className="btn btn-primary"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

// ==================== 6. 表格加载态 ====================
export const TableLoading: React.FC<{ rows?: number; columns?: number }> = ({ 
  rows = 5, 
  columns = 6 
}) => {
  return (
    <div className="space-y-2 animate-fade-in">
      {/* 表头 */}
      <div className="flex gap-4 px-4 py-3 bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="flex-1">
            <div className="h-3 bg-slate-200 rounded skeleton" style={{ width: '60%' }} />
          </div>
        ))}
      </div>
      
      {/* 表格行 */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div 
          key={rowIndex} 
          className="flex gap-4 px-4 py-4 bg-white/60 backdrop-blur rounded-xl border border-slate-100/50 stagger-item"
          style={{ animationDelay: `${rowIndex * 60}ms` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <div key={colIndex} className="flex-1">
              <div className="h-3.5 bg-slate-200 rounded skeleton" style={{ width: `${60 + Math.random() * 30}%` }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ==================== 7. 卡片加载态 ====================
export const CardLoading: React.FC<{ count?: number }> = ({ count = 4 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className="glass-loading-card p-6 space-y-4 stagger-item"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-slate-200 rounded-2xl skeleton" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-slate-200 rounded skeleton" style={{ width: '70%' }} />
              <div className="h-3 bg-slate-200 rounded skeleton" style={{ width: '50%' }} />
            </div>
          </div>
          <div className="h-20 bg-slate-200 rounded-xl skeleton" />
          <div className="flex gap-2">
            <div className="h-6 bg-slate-200 rounded-full skeleton" style={{ width: '80px' }} />
            <div className="h-6 bg-slate-200 rounded-full skeleton" style={{ width: '60px' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ==================== 8. 页面加载态 ====================
interface PageLoadingProps {
  message?: string
  fullScreen?: boolean
}

export const PageLoading: React.FC<PageLoadingProps> = ({ 
  message = '加载中...', 
  fullScreen = false 
}) => {
  const content = (
    <div className="flex flex-col items-center justify-center gap-6 py-20">
      <div className="glass-loading-card p-8 flex flex-col items-center gap-4 animate-fade-in">
        <Spinner size="lg" color="blue" />
        <p className="text-base text-slate-600 font-medium">{message}</p>
      </div>
    </div>
  )
  
  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-50">
        {content}
      </div>
    )
  }
  
  return content
}

// 默认导出
export default {
  Spinner,
  Overlay: LoadingOverlay,
  Inline: InlineLoading,
  FullScreen: FullScreenLoading,
  Empty: EmptyState,
  Table: TableLoading,
  Card: CardLoading,
  Page: PageLoading,
}
