/**
 * 骨架屏组件 - 用于加载状态的优雅展示
 */

interface SkeletonProps {
  className?: string
  variant?: 'text' | 'circular' | 'rectangular'
  width?: string | number
  height?: string | number
  animation?: 'shimmer' | 'pulse' | 'none'
}

export function Skeleton({ 
  className = '', 
  variant = 'rectangular',
  width,
  height,
  animation = 'shimmer'
}: SkeletonProps) {
  const baseClass = 'bg-slate-200'
  
  const variantClass = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  }[variant]
  
  const animationClass = {
    shimmer: 'skeleton',
    pulse: 'animate-pulse-soft',
    none: '',
  }[animation]
  
  const style: React.CSSProperties = {}
  if (width) style.width = typeof width === 'number' ? `${width}px` : width
  if (height) style.height = typeof height === 'number' ? `${height}px` : height
  
  return (
    <div 
      className={`${baseClass} ${variantClass} ${animationClass} ${className}`}
      style={style}
    />
  )
}

// 表格骨架屏
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3">
      {/* 表头 */}
      <div className="flex gap-4 px-4 py-3 bg-slate-100 rounded-lg">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height={16} className="flex-1" />
        ))}
      </div>
      
      {/* 表格行 */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div 
          key={rowIndex} 
          className="flex gap-4 px-4 py-4 bg-white rounded-lg border border-slate-100 stagger-item"
          style={{ animationDelay: `${rowIndex * 50}ms` }}
        >
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton 
              key={colIndex} 
              height={14} 
              className="flex-1"
              width={colIndex === 0 ? '80%' : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// 卡片骨架屏
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className="p-6 bg-white rounded-2xl border border-slate-100 space-y-4 stagger-item"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex items-center gap-3">
            <Skeleton variant="circular" width={40} height={40} />
            <div className="flex-1 space-y-2">
              <Skeleton height={14} width="60%" />
              <Skeleton height={10} width="40%" />
            </div>
          </div>
          <Skeleton height={60} />
          <div className="flex gap-2">
            <Skeleton height={24} width={80} className="rounded-full" />
            <Skeleton height={24} width={60} className="rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

// 统计数据骨架屏
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className="p-5 bg-white/80 backdrop-blur rounded-2xl border border-white/50 shadow-lg stagger-item"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="flex items-center gap-3 mb-3">
            <Skeleton variant="circular" width={36} height={36} />
            <Skeleton height={12} width="50%" />
          </div>
          <Skeleton height={28} width="70%" className="mb-2" />
          <Skeleton height={10} width="40%" />
        </div>
      ))}
    </div>
  )
}

// 列表骨架屏
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div 
          key={i} 
          className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-100 stagger-item"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton variant="circular" width={48} height={48} />
          <div className="flex-1 space-y-2">
            <Skeleton height={14} width="30%" />
            <Skeleton height={10} width="50%" />
          </div>
          <Skeleton height={32} width={80} className="rounded-lg" />
        </div>
      ))}
    </div>
  )
}

export default Skeleton

