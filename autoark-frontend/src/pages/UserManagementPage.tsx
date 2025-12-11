import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

interface User {
  _id: string
  username: string
  email: string
  role: string
  status: string
  organizationId?: any
  createdAt: string
}

const UserManagementPage: React.FC = () => {
  const { token, isSuperAdmin, isOrgAdmin, user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [organizations, setOrganizations] = useState<any[]>([])
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    role: 'member',
    organizationId: '',
  })
  const [editFormData, setEditFormData] = useState({
    username: '',
    email: '',
    role: 'member',
    organizationId: '',
    status: 'active',
  })

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users', {
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
        setUsers(data.data)
      } else {
        console.error('获取用户列表失败:', data.message)
      }
    } catch (error) {
      console.error('获取用户列表失败:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchOrganizations = async () => {
    if (!isSuperAdmin) return
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
    if (token) {
      fetchUsers()
      fetchOrganizations()
    }
  }, [token])

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      })
      const data = await response.json()
      if (data.success) {
        alert('用户创建成功')
        setShowCreateModal(false)
        setFormData({
          username: '',
          password: '',
          email: '',
          role: 'member',
          organizationId: '',
        })
        fetchUsers()
      } else {
        alert(data.message || '创建失败')
      }
    } catch (error) {
      console.error('创建用户失败:', error)
      alert('创建失败')
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('确定要删除此用户吗？')) return

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (data.success) {
        alert('用户删除成功')
        fetchUsers()
      } else {
        alert(data.message || '删除失败')
      }
    } catch (error) {
      console.error('删除用户失败:', error)
      alert('删除失败')
    }
  }

  const handleEditClick = (userToEdit: User) => {
    setEditingUser(userToEdit)
    setEditFormData({
      username: userToEdit.username,
      email: userToEdit.email,
      role: userToEdit.role,
      organizationId: userToEdit.organizationId?._id || userToEdit.organizationId || '',
      status: userToEdit.status,
    })
    setShowEditModal(true)
  }

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingUser) return

    try {
      const response = await fetch(`/api/users/${editingUser._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(editFormData),
      })
      const data = await response.json()
      if (data.success) {
        alert('用户更新成功')
        setShowEditModal(false)
        setEditingUser(null)
        fetchUsers()
      } else {
        alert(data.message || '更新失败')
      }
    } catch (error) {
      console.error('更新用户失败:', error)
      alert('更新失败')
    }
  }

  const getRoleName = (role: string) => {
    const roleMap: any = {
      super_admin: '超级管理员',
      org_admin: '组织管理员',
      member: '普通成员',
    }
    return roleMap[role] || role
  }

  const getStatusName = (status: string) => {
    const statusMap: any = {
      active: '激活',
      inactive: '未激活',
      suspended: '已停用',
    }
    return statusMap[status] || status
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
          <h1 className="text-2xl font-bold text-gray-800">用户管理</h1>
          {(isSuperAdmin || isOrgAdmin) && (
            <button
              onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
            + 创建用户
            </button>
          )}
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  用户名
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  邮箱
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  角色
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  组织
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  状态
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map((u) => (
                <tr key={u._id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {u.username}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {u.email}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {getRoleName(u.role)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {u.organizationId?.name || '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        u.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {getStatusName(u.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 space-x-3">
                    {(isSuperAdmin || isOrgAdmin) && (
                      <button
                        onClick={() => handleEditClick(u)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        编辑
                      </button>
                    )}
                    {/* 超级管理员可删除非超管用户，组织管理员只能删除普通成员 */}
                    {((isSuperAdmin && u.role !== 'superadmin' && u._id !== user?._id) ||
                      (isOrgAdmin && u.role === 'member')) && (
                      <button
                        onClick={() => handleDeleteUser(u._id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 编辑用户模态框 */}
        {showEditModal && editingUser && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">编辑用户</h2>
              <form onSubmit={handleUpdateUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={editFormData.username}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, username: e.target.value })
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
                    value={editFormData.email}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, email: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                {isSuperAdmin && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        角色
                      </label>
                      <select
                        value={editFormData.role}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, role: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="member">普通成员</option>
                        <option value="org_admin">组织管理员</option>
                        <option value="super_admin">超级管理员</option>
                      </select>
                    </div>
                    {editFormData.role !== 'super_admin' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          所属组织
                        </label>
                        <select
                          value={editFormData.organizationId}
                          onChange={(e) =>
                            setEditFormData({ ...editFormData, organizationId: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        >
                          <option value="">请选择组织</option>
                          {organizations.map((org) => (
                            <option key={org._id} value={org._id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
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
                    <option value="inactive">未激活</option>
                    <option value="suspended">已停用</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditModal(false)
                      setEditingUser(null)
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

        {/* 创建用户模态框 */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h2 className="text-xl font-bold mb-4">创建新用户</h2>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用户名
                  </label>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) =>
                      setFormData({ ...formData, username: e.target.value })
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
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
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
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  />
                </div>
                {isSuperAdmin && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        角色
                      </label>
                      <select
                        value={formData.role}
                        onChange={(e) =>
                          setFormData({ ...formData, role: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="member">普通成员</option>
                        <option value="org_admin">组织管理员</option>
                        <option value="super_admin">超级管理员</option>
                      </select>
                    </div>
                    {formData.role !== 'super_admin' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          所属组织
                        </label>
                        <select
                          value={formData.organizationId}
                          onChange={(e) =>
                            setFormData({ ...formData, organizationId: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                          required
                        >
                          <option value="">请选择组织</option>
                          {organizations.map((org) => (
                            <option key={org._id} value={org._id}>
                              {org.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}
                {isOrgAdmin && user?.organizationId && (
                  <input
                    type="hidden"
                    value={user.organizationId}
                    onChange={(e) =>
                      setFormData({ ...formData, organizationId: e.target.value })
                    }
                  />
                )}
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
      </div>
  )
}

export default UserManagementPage
