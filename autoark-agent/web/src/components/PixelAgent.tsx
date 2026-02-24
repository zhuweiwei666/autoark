/**
 * PixelAgent — 像素风 Agent 角色组件
 * 每个 Agent 是一个 CSS 像素画小人，带表情状态和动画
 */

type AgentType = 'monitor' | 'screener' | 'decision' | 'executor' | 'auditor' | 'librarian'
type AgentMood = 'idle' | 'working' | 'happy' | 'alert' | 'thinking'

interface Props {
  type: AgentType
  mood?: AgentMood
  size?: number
}

const AGENTS: Record<AgentType, { emoji: string; label: string; color: string; role: string }> = {
  monitor:   { emoji: '🔭', label: '侦察兵', color: '#06b6d4', role: '数据感知' },
  screener:  { emoji: '🛡️', label: '守门员', color: '#3b82f6', role: '筛选把关' },
  decision:  { emoji: '🧠', label: '军师',   color: '#8b5cf6', role: '策略决策' },
  executor:  { emoji: '⚡', label: '工匠',   color: '#10b981', role: '执行操作' },
  auditor:   { emoji: '⚖️', label: '法官',   color: '#f59e0b', role: '审查反馈' },
  librarian: { emoji: '📚', label: '馆长',   color: '#eab308', role: '知识管理' },
}

const MOOD_BUBBLES: Record<AgentMood, string> = {
  idle: '💤',
  working: '⚙️',
  happy: '✨',
  alert: '❗',
  thinking: '💭',
}

export default function PixelAgent({ type, mood = 'idle', size = 64 }: Props) {
  const agent = AGENTS[type]
  const bubble = MOOD_BUBBLES[mood]
  const isWorking = mood === 'working' || mood === 'thinking'

  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size + 16 }}>
      {/* 表情气泡 */}
      <div className={`absolute -top-2 -right-1 text-sm z-10 ${isWorking ? 'animate-bounce' : mood === 'alert' ? 'animate-pulse' : ''}`}
        style={{ fontSize: size * 0.3 }}>
        {bubble}
      </div>

      {/* 像素角色容器 */}
      <div
        className={`relative rounded-xl flex items-center justify-center ${isWorking ? 'animate-pixel-work' : ''}`}
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${agent.color}15, ${agent.color}08)`,
          border: `2px solid ${agent.color}40`,
          boxShadow: isWorking ? `0 0 20px ${agent.color}30` : 'none',
          transition: 'box-shadow 0.3s',
        }}
      >
        {/* 像素身体 — 用 box-shadow 构建 8x8 像素网格 */}
        <div className="relative" style={{ fontSize: size * 0.5 }}>
          {agent.emoji}
        </div>

        {/* 活跃指示器 */}
        {isWorking && (
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-full" style={{
                width: size * 0.06,
                height: size * 0.06,
                background: agent.color,
                animation: `pixelDot 1s ${i * 0.2}s infinite`,
              }} />
            ))}
          </div>
        )}
      </div>

      {/* 角色名 */}
      <div className="mt-1 text-center">
        <div className="text-[10px] font-bold" style={{ color: agent.color }}>{agent.label}</div>
      </div>

      <style>{`
        @keyframes pixelDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes animate-pixel-work {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        .animate-pixel-work {
          animation: animate-pixel-work 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

export { AGENTS, type AgentType, type AgentMood }
