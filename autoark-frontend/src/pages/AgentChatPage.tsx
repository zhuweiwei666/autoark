/**
 * Agent Chat Page
 * 
 * Chat-first interface for interacting with the AI Agent.
 * Users can:
 * - Chat with the agent (auto-routes to analyst/planner/executor/creative)
 * - View agent thinking process and tool calls
 * - See recommendations and approve/reject actions
 * - Review session history
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { authFetch } from '../services/api'

const API_BASE = ''

// ==================== Types ====================

interface AgentMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  timestamp: Date
  toolCalls?: ToolCallInfo[]
  agentRole?: string
  status?: string
  sessionId?: string
  durationMs?: number
}

interface ToolCallInfo {
  toolName: string
  args: any
  result: any
  approved: boolean
  durationMs: number
}

interface AgentOption {
  id: string
  name: string
}

// ==================== API ====================

async function fetchAgents(): Promise<AgentOption[]> {
  const res = await authFetch(`${API_BASE}/api/agent`)
  const data = await res.json()
  return (data.data || []).map((a: any) => ({ id: a._id, name: a.name }))
}

async function sendAgentChat(agentId: string, message: string, agentRole?: string) {
  const res = await authFetch(`${API_BASE}/api/v2/agent/chat`, {
    method: 'POST',
    body: JSON.stringify({ agentId, message, agentRole }),
  })
  return res.json()
}

async function fetchSessions(agentId?: string) {
  const params = agentId ? `?agentId=${agentId}&limit=20` : '?limit=20'
  const res = await authFetch(`${API_BASE}/api/v2/agent/sessions${params}`)
  return res.json()
}

// ==================== Component ====================

export default function AgentChatPage() {
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [inputMessage, setInputMessage] = useState('')
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [showSessions, setShowSessions] = useState(false)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch agents
  const { data: agents = [] } = useQuery({
    queryKey: ['agents-list'],
    queryFn: fetchAgents,
  })

  // Fetch sessions
  const { data: sessionsData } = useQuery({
    queryKey: ['agent-sessions', selectedAgent],
    queryFn: () => fetchSessions(selectedAgent),
    enabled: showSessions,
  })

  // Send message mutation
  const chatMutation = useMutation({
    mutationFn: ({ agentId, message }: { agentId: string; message: string }) =>
      sendAgentChat(agentId, message),
    onSuccess: (data) => {
      setIsThinking(false)
      if (data.success && data.data) {
        const result = data.data
        const agentMsg: AgentMessage = {
          id: result.sessionId || Date.now().toString(),
          role: 'agent',
          content: result.summary || 'Agent completed without response.',
          timestamp: new Date(),
          toolCalls: (result.toolCalls || []).map((tc: any) => ({
            toolName: tc.toolName,
            args: tc.args,
            result: tc.result,
            approved: tc.guardrailCheck?.approved ?? true,
            durationMs: tc.durationMs,
          })),
          agentRole: result.role,
          status: result.status,
          sessionId: result.sessionId,
          durationMs: result.durationMs,
        }
        setMessages(prev => [...prev, agentMsg])
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'system',
            content: `Error: ${data.error || 'Unknown error'}`,
            timestamp: new Date(),
          },
        ])
      }
    },
    onError: (error: any) => {
      setIsThinking(false)
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'system',
          content: `Error: ${error.message}`,
          timestamp: new Date(),
        },
      ])
    },
  })

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // Auto-select first agent
  useEffect(() => {
    if (agents.length > 0 && !selectedAgent) {
      setSelectedAgent(agents[0].id)
    }
  }, [agents, selectedAgent])

  const handleSend = () => {
    if (!inputMessage.trim() || !selectedAgent || isThinking) return

    const userMsg: AgentMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputMessage,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsThinking(true)
    chatMutation.mutate({ agentId: selectedAgent, message: inputMessage })
    setInputMessage('')
  }

  const toggleToolCallExpand = (msgId: string) => {
    setExpandedToolCalls(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) next.delete(msgId)
      else next.add(msgId)
      return next
    })
  }

  // Quick action buttons
  const quickActions = [
    { label: 'Analyze Performance', message: 'Analyze the performance of all campaigns in the last 7 days. What should we scale, pause, or optimize?' },
    { label: 'Check Creative Fatigue', message: 'Check for creative fatigue across all active materials. Which creatives should be refreshed?' },
    { label: 'Campaign Strategy', message: 'Based on current performance data, what campaign strategy changes do you recommend?' },
    { label: 'Daily Report', message: 'Generate a daily performance report with key metrics and actionable insights.' },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-slate-800">Agent Chat</h1>
          <select
            value={selectedAgent}
            onChange={e => setSelectedAgent(e.target.value)}
            className="px-3 py-1.5 bg-white/80 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select Agent...</option>
            {agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="px-3 py-1.5 text-sm bg-white/60 hover:bg-white/80 border border-slate-200 rounded-lg transition-colors"
          >
            {showSessions ? 'Hide History' : 'History'}
          </button>
          <button
            onClick={() => setMessages([])}
            className="px-3 py-1.5 text-sm bg-white/60 hover:bg-white/80 border border-slate-200 rounded-lg transition-colors"
          >
            Clear Chat
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-4xl mb-4">🤖</div>
                <h2 className="text-xl font-semibold text-slate-700 mb-2">AutoArk Agent</h2>
                <p className="text-slate-500 mb-6 max-w-md">
                  Chat with the AI agent to analyze campaigns, plan strategies, execute optimizations, or check creative performance.
                </p>
                <div className="grid grid-cols-2 gap-3 max-w-lg">
                  {quickActions.map((qa, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInputMessage(qa.message)
                      }}
                      className="p-3 text-left text-sm bg-white/70 hover:bg-white/90 border border-slate-200 rounded-xl transition-all hover:shadow-md"
                    >
                      <span className="font-medium text-slate-700">{qa.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] ${msg.role === 'user'
                  ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                  : msg.role === 'system'
                    ? 'bg-red-50 text-red-700 border border-red-200 rounded-2xl'
                    : 'bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl rounded-bl-md'
                  } px-4 py-3 shadow-sm`}>
                  {/* Agent role badge */}
                  {msg.agentRole && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                        {msg.agentRole}
                      </span>
                      {msg.durationMs && (
                        <span className="text-xs text-slate-400">
                          {(msg.durationMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {msg.status && msg.status !== 'completed' && (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          msg.status === 'failed' ? 'bg-red-100 text-red-700' :
                          msg.status === 'max_iterations' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {msg.status}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Message content */}
                  <div className={`text-sm whitespace-pre-wrap ${msg.role === 'user' ? '' : 'text-slate-700'}`}>
                    {msg.content}
                  </div>

                  {/* Tool calls */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="mt-3 border-t border-slate-200/50 pt-2">
                      <button
                        onClick={() => toggleToolCallExpand(msg.id)}
                        className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                      >
                        <span>{expandedToolCalls.has(msg.id) ? '▼' : '▶'}</span>
                        <span>{msg.toolCalls.length} tool call{msg.toolCalls.length > 1 ? 's' : ''}</span>
                      </button>
                      {expandedToolCalls.has(msg.id) && (
                        <div className="mt-2 space-y-2">
                          {msg.toolCalls.map((tc, i) => (
                            <div key={i} className="bg-slate-50/80 rounded-lg p-2 text-xs">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono font-medium text-blue-600">{tc.toolName}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  tc.result?.success ? 'bg-emerald-100 text-emerald-700' :
                                  !tc.approved ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {tc.result?.success ? 'OK' : !tc.approved ? 'BLOCKED' : 'FAIL'}
                                </span>
                                <span className="text-slate-400">{tc.durationMs}ms</span>
                              </div>
                              <pre className="text-[10px] text-slate-500 overflow-x-auto max-h-20 overflow-y-auto">
                                {JSON.stringify(tc.args, null, 2)}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Timestamp */}
                  <div className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-slate-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {/* Thinking indicator */}
            {isThinking && (
              <div className="flex justify-start">
                <div className="bg-white/80 backdrop-blur-sm border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs text-slate-500">Agent is thinking...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/10 bg-white/5 backdrop-blur-sm p-4">
            <div className="flex gap-3 max-w-4xl mx-auto">
              <input
                type="text"
                value={inputMessage}
                onChange={e => setInputMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder={selectedAgent ? 'Ask the agent anything...' : 'Select an agent first...'}
                disabled={!selectedAgent || isThinking}
                className="flex-1 px-4 py-2.5 bg-white/80 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!selectedAgent || !inputMessage.trim() || isThinking}
                className="px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl text-sm font-medium hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {/* Sessions Sidebar */}
        {showSessions && (
          <div className="w-80 border-l border-white/10 bg-white/5 backdrop-blur-sm overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Recent Sessions</h3>
              {sessionsData?.data?.map((session: any) => (
                <div
                  key={session.sessionId}
                  className="mb-2 p-3 bg-white/60 rounded-lg border border-slate-200/50 hover:bg-white/80 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-blue-600">{session.agentRole}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      session.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                      session.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {session.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {session.summary || session.inputContext || 'No summary'}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                    <span>{session.totalToolCalls || 0} tools</span>
                    <span>{session.durationMs ? (session.durationMs / 1000).toFixed(1) + 's' : ''}</span>
                    <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
              {(!sessionsData?.data || sessionsData.data.length === 0) && (
                <p className="text-xs text-slate-400 text-center py-4">No sessions yet</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
