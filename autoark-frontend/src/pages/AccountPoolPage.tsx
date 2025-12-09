import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

interface Account {
  _id: string
  accountId: string
  name?: string
  channel: string
  status?: string
  organizationId?: any
  tags?: string[]
  groupId?: any
  notes?: string
  assignedBy?: any
  assignedAt?: string
  createdAt: string
}

interface Organization {
  _id: string
  name: string
}

const AccountPoolPage: React.FC = () => {
  const { token, isSuperAdmin } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showTagModal, setShowTagModal] = useState(false)
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [newTag, setNewTag] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [filterOrg, setFilterOrg] = useState('')
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false)

  const fetchAccounts = async () => {
    try {
      const params = new URLSearchParams()
      if (filterTag) params.append('tags', filterTag)
      if (filterOrg) params.append('organizationId', filterOrg)
      if (showUnassignedOnly) params.append('unassigned', 'true')

      const response = await fetch(`/api/account-management/accounts?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (data.success) {
        setAccounts(data.data)
      }
    } catch (error) {
      console.error('获取账户列表失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchOrganizations = async () => {
    try {
      const response = await fetch('/api/organizations', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (data.success) {
        setOrganizations(data.data)
      }
    } catch (error) {
      console.error('获取组织列表失败:', error)
    }
  }

  useEffect(() => {
    if (token && isSuperAdmin) {
      fetchAccounts()
      fetchOrganizations()
    }
  }, [token, isSuperAdmin, filterTag, filterOrg, showUnassignedOnly])

  const handleSelectAccount = (accountId: string) => {
    setSelectedAccounts(prev =>
      prev.includes(accountId)
        ? prev.filter(id => id !== accountId)
        : [...prev, accountId]
    )
  }

  const handleSelectAll = () => {
    if (selectedAccounts.length === accounts.length) {
      setSelectedAccounts([])
    } else {
      setSelectedAccounts(accounts.map(a => a.accountId))
    }
  }

  const handleAssignToOrg = async () => {
    if (!selectedOrgId || selectedAccounts.length === 0) {
      alert('请选择组织和账户')
      return
    }

    try {
      const response = await fetch('/api/account-management/assign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountIds: selectedAccounts,
          organizationId: selectedOrgId,
        }),
      })
      const data = await response.json()
      if (data.success) {
        alert(`成功分配 ${data.data.count} 个账户`)
        setShowAssignModal(false)
        setSelectedAccounts([])
        setSelectedOrgId('')
        fetchAccounts()
      } else {
        alert(data.message || '分配失败')
      }
    } catch (error) {
      console.error('分配账户失败:', error)
      alert('分配失败')
    }
  }

  const handleUnassign = async () => {
    if (selectedAccounts.length === 0) {
      alert('请选择要回收的账户')
      return
    }

    if (!confirm(`确定要回收 ${selectedAccounts.length} 个账户到账户池吗？`)) return

    try {
      const response = await fetch('/api/account-management/unassign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountIds: selectedAccounts,
        }),
      })
      const data = await response.json()
      if (data.success) {
        alert(`成功回收 ${data.data.count} 个账户`)
        setSelectedAccounts([])
        fetchAccounts()
      } else {
        alert(data.message || '回收失败')
      }
    } catch (error) {
      console.error('回收账户失败:', error)
      alert('回收失败')
    }
  }

  const handleAddTag = async () => {
    if (!newTag || selectedAccounts.length === 0) {
      alert('请输入标签名称并选择账户')
      return
    }

    try {
      // 为每个选中的账户添加标签
      const promises = selectedAccounts.map(accountId =>
        fetch(`/api/account-management/accounts/${accountId}/tags`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            tags: [newTag],
          }),
        })
      )

      await Promise.all(promises)
      alert(`成功为 ${selectedAccounts.length} 个账户添加标签`)
      setShowTagModal(false)
      setNewTag('')
      setSelectedAccounts([])
      fetchAccounts()
    } catch (error) {
      console.error('添加标签失败:', error)
      alert('添加标签失败')
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-600">
          <p>只有超级管理员可以访问账户池</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">加载中...</div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* 顶部操作栏 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800 mb-4">账户池管理</h1>
        
        {/* 筛选器 */}
        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="按标签筛选..."
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <select
            value={filterOrg}
            onChange={(e) => setFilterOrg(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">所有组织</option>
            {organizations.map(org => (
              <option key={org._id} value={org._id}>{org.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={showUnassignedOnly}
              onChange={(e) => setShowUnassignedOnly(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">仅显示未分配</span>
          </label>
        </div>

        {/* 批量操作按钮 */}
        {selectedAccounts.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowAssignModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              分配到组织 ({selectedAccounts.length})
            </button>
            <button
              onClick={() => setShowTagModal(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              添加标签 ({selectedAccounts.length})
            </button>
            <button
              onClick={handleUnassign}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"
            >
              回收到账户池 ({selectedAccounts.length})
            </button>
            <button
              onClick={() => setSelectedAccounts([])}
              className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              取消选择
            </button>
          </div>
        )}
      </div>

      {/* 统计信息 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">总账户数</div>
          <div className="text-2xl font-bold text-gray-800">{accounts.length}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">未分配</div>
          <div className="text-2xl font-bold text-orange-600">
            {accounts.filter(a => !a.organizationId).length}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">已选中</div>
          <div className="text-2xl font-bold text-blue-600">{selectedAccounts.length}</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="text-sm text-gray-600">组织数</div>
          <div className="text-2xl font-bold text-gray-800">{organizations.length}</div>
        </div>
      </div>

      {/* 账户列表 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3">
                <input
                  type="checkbox"
                  checked={selectedAccounts.length === accounts.length && accounts.length > 0}
                  onChange={handleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                账户ID
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                账户名称
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                所属组织
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                标签
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                备注
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                状态
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {accounts.map((account) => (
              <tr key={account._id} className="hover:bg-gray-50">
                <td className="px-6 py-4">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.includes(account.accountId)}
                    onChange={() => handleSelectAccount(account.accountId)}
                    className="rounded"
                  />
                </td>
                <td className="px-6 py-4 text-sm font-mono text-gray-900">
                  {account.accountId}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">
                  {account.name || '-'}
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {account.organizationId?.name ? (
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                      {account.organizationId.name}
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-orange-100 text-orange-800 rounded-full text-xs">
                      未分配
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex flex-wrap gap-1">
                    {account.tags?.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                  {account.notes || '-'}
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2 py-1 rounded-full text-xs ${
                      account.status === 'ACTIVE'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {account.status || '未知'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分配到组织模态框 */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">分配账户到组织</h2>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                已选择 {selectedAccounts.length} 个账户
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                选择目标组织
              </label>
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              >
                <option value="">请选择组织</option>
                {organizations.map(org => (
                  <option key={org._id} value={org._id}>{org.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleAssignToOrg}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                确认分配
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加标签模态框 */}
      {showTagModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">添加标签</h2>
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                已选择 {selectedAccounts.length} 个账户
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                标签名称
              </label>
              <input
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="例如：电商、品牌A、测试账户"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                常用标签：电商、服装、电子产品、测试、生产、品牌A、品牌B
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowTagModal(false)
                  setNewTag('')
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleAddTag}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                添加标签
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountPoolPage
