import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { authFetch } from '../services/api'

interface Organization {
  _id: string
  name: string
  description?: string
  adminId: any
  status: string
  billing?: {
    plan?: string
    status?: string
    seats?: number
    trialEndsAt?: string
    currentPeriodEndsAt?: string
  }
  settings?: {
    maxMembers?: number
    maxAdAccounts?: number
    maxMaterials?: number
    maxConcurrentTasks?: number
    monthlyTaskLimit?: number
    features?: string[]
  }
  createdAt: string
}

const OrganizationManagementPage: React.FC = () => {
  const { token, isSuperAdmin } = useAuth()
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    adminUsername: '',
    adminPassword: '',
    adminEmail: '',
  })
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: '',
    status: 'active',
    plan: 'trial',
    billingStatus: 'trialing',
    maxMembers: '',
    maxAdAccounts: '',
    maxMaterials: '',
    maxConcurrentTasks: '',
    monthlyTaskLimit: '',
  })

  const fetchOrganizations = async () => {
    try {
      const response = await authFetch('/api/organizations', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (response.status === 401) {
        alert('登录已过期，请重新登录')
        window.location.href = '/login'
        return
      }
      if (data.success) {
        setOrganizations(data.data)
      } else {
        console.error('获取组织列表失败:', data.message)
      }
    } catch (error) {
      console.error('获取组织列表失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isSuperAdmin && token) {
      fetchOrganizations()
    } else {
      setIsLoading(false)
    }
  }, [token, isSuperAdmin])

  const handleCreateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await authFetch('/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })
      const data = await response.json()
      if (data.success) {
        alert('组织创建成功')
        setShowCreateModal(false)
        setFormData({
          name: '',
          description: '',
          adminUsername: '',
          adminPassword: '',
          adminEmail: '',
        })
        fetchOrganizations()
      } else {
        alert(data.message || '创建失败')
      }
    } catch (error) {
      console.error('创建组织失败:', error)
      alert('创建失败')
    }
  }

  const handleDeleteOrganization = async (orgId: string) => {
    if (!confirm('确定要删除此组织吗？组织下不能有任何用户。')) return

    try {
      const response = await authFetch(`/api/organizations/${orgId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (data.success) {
        alert('组织删除成功')
        fetchOrganizations()
      } else {
        alert(data.message || '删除失败')
      }
    } catch (error) {
      console.error('删除组织失败:', error)
      alert('删除失败')
    }
  }

  const handleEditClick = (org: Organization) => {
    setEditingOrg(org)
    setEditFormData({
      name: org.name,
      description: org.description || '',
      status: org.status,
      plan: org.billing?.plan || 'trial',
      billingStatus: org.billing?.status || 'trialing',
      maxMembers: org.settings?.maxMembers?.toString() || '',
      maxAdAccounts: org.settings?.maxAdAccounts?.toString() || '',
      maxMaterials: org.settings?.maxMaterials?.toString() || '',
      maxConcurrentTasks: org.settings?.maxConcurrentTasks?.toString() || '',
      monthlyTaskLimit: org.settings?.monthlyTaskLimit?.toString() || '',
    })
    setShowEditModal(true)
  }

  const handleUpdateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingOrg) return

    const optionalNumber = (value: string) => {
      if (value.trim() === '') return null
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    const payload = {
      name: editFormData.name,
      description: editFormData.description,
      status: editFormData.status,
      billing: {
        plan: editFormData.plan,
        status: editFormData.billingStatus,
      },
      settings: {
        maxMembers: optionalNumber(editFormData.maxMembers),
        maxAdAccounts: optionalNumber(editFormData.maxAdAccounts),
        maxMaterials: optionalNumber(editFormData.maxMaterials),
        maxConcurrentTasks: optionalNumber(editFormData.maxConcurrentTasks),
        monthlyTaskLimit: optionalNumber(editFormData.monthlyTaskLimit),
      },
    }

    try {
      const response = await authFetch(`/api/organizations/${editingOrg._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await response.json()
      if (data.success) {
        alert('组织更新成功')
        setShowEditModal(false)
        setEditingOrg(null)
        fetchOrganizations()
      } else {
        alert(data.message || '更新失败')
      }
    } catch (error) {
      console.error('更新组织失败:', error)
      alert('更新失败')
    }
  }

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-600">
          <p>只有超级管理员可以访问此页面</p>
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
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">组织管理</h1>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            + 创建组织
          </button>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  组织名称
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  描述
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  管理员
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  套餐/额度
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  创建时间
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {organizations.map((org) => (
                <tr key={org._id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {org.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {org.description || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {org.adminId?.username || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        org.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {org.status === 'active' ? '激活' : '停用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="font-medium text-gray-900">{org.billing?.plan || 'trial'} · {org.billing?.status || 'trialing'}</div>
                    <div className="text-xs text-gray-500">
                      成员 {org.settings?.maxMembers || '-'} · 账户 {org.settings?.maxAdAccounts || '-'} · 月任务 {org.settings?.monthlyTaskLimit || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(org.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 space-x-3">
                    <Link
                      to={`/commercial?organizationId=${org._id}`}
                      className="text-emerald-700 hover:text-emerald-900"
                    >
                      商用验收
                    </Link>
                    <button
                      onClick={() => handleEditClick(org)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteOrganization(org._id)}
                      className="text-red-600 hover:text-red-900"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 创建组织模态框 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">创建新组织</h2>
              <form onSubmit={handleCreateOrganization} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    组织名称
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    描述
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    rows={3}
                  />
                </div>
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">
                    组织管理员信息
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        用户名
                      </label>
                      <input
                        type="text"
                        value={formData.adminUsername}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            adminUsername: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        密码
                      </label>
                      <input
                        type="password"
                        value={formData.adminPassword}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            adminPassword: e.target.value,
                          })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        邮箱
                      </label>
                      <input
                        type="email"
                        value={formData.adminEmail}
                        onChange={(e) =>
                          setFormData({ ...formData, adminEmail: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-6">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    创建
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 编辑组织模态框 */}
        {showEditModal && editingOrg && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-xl font-bold mb-4">编辑组织</h2>
              <form onSubmit={handleUpdateOrganization} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    组织名称
                  </label>
                  <input
                    type="text"
                    value={editFormData.name}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    描述
                  </label>
                  <textarea
                    value={editFormData.description}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, description: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    rows={3}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    状态
                  </label>
                  <select
                    value={editFormData.status}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, status: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="active">激活</option>
                    <option value="inactive">停用</option>
                  </select>
                </div>
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">套餐与账单</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        套餐
                      </label>
                      <select
                        value={editFormData.plan}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, plan: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="trial">试用版</option>
                        <option value="starter">标准版</option>
                        <option value="growth">增长版</option>
                        <option value="enterprise">企业版</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        账单状态
                      </label>
                      <select
                        value={editFormData.billingStatus}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, billingStatus: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="trialing">试用中</option>
                        <option value="active">正常</option>
                        <option value="past_due">逾期</option>
                        <option value="paused">暂停</option>
                        <option value="canceled">已取消</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">额度覆盖</h3>
                  <p className="mb-3 text-xs font-medium text-gray-500">
                    留空会清除手动覆盖并回到当前套餐默认额度；填 0 表示显式限制为 0。
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['maxMembers', '成员上限'],
                      ['maxAdAccounts', '广告账户上限'],
                      ['maxMaterials', '素材上限'],
                      ['maxConcurrentTasks', '并发任务上限'],
                      ['monthlyTaskLimit', '月任务上限'],
                    ].map(([key, label]) => (
                      <div key={key}>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {label}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={(editFormData as any)[key]}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, [key]: e.target.value })
                          }
                          placeholder="使用套餐默认"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false)
                      setEditingOrg(null)
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    保存
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
  )
}

export default OrganizationManagementPage
