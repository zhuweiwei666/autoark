import { Request, Response } from 'express'
import userService from '../services/user.service'
import logger from '../utils/logger'
import { writeAuditLog } from '../services/auditLog.service'
import { parsePagination, pickSafeQueryString } from '../utils/pagination'
import {
  pickSafePassword,
  pickUserRole,
  pickUserStatus,
  sanitizeUserCreateInput,
  sanitizeUserUpdateInput,
  USER_ORGANIZATION_ID_MAX_LENGTH,
} from '../utils/userInput'

const USER_LIST_MAX_PAGE_SIZE = 100

class UserController {
  /**
   * GET /api/users
   * 获取用户列表
   */
  async getUsers(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { page, pageSize, skip } = parsePagination(req.query, {
        defaultPageSize: 50,
        maxPageSize: USER_LIST_MAX_PAGE_SIZE,
      })
      const filters = {
        organizationId: pickSafeQueryString(req.query.organizationId, USER_ORGANIZATION_ID_MAX_LENGTH),
        role: pickUserRole(req.query.role),
        status: pickUserStatus(req.query.status),
      }

      const result = await userService.getUsers(req.user, filters, { page, pageSize, skip })

      res.json({
        success: true,
        data: result.data,
        total: result.total,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / result.pageSize),
        },
      })
    } catch (error: any) {
      logger.error('Get users error:', error)
      res.status(500).json({
        success: false,
        message: error.message || '获取用户列表失败',
      })
    }
  }

  /**
   * GET /api/users/:id
   * 获取用户详情
   */
  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const user = await userService.getUserById(req.params.id, req.user)

      res.json({
        success: true,
        data: user,
      })
    } catch (error: any) {
      logger.error('Get user by id error:', error)
      res.status(error.message.includes('无权') ? 403 : 404).json({
        success: false,
        message: error.message || '获取用户信息失败',
      })
    }
  }

  /**
   * POST /api/users
   * 创建用户
   */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const input = sanitizeUserCreateInput(req.body)

      if (!input.username || !input.password || !input.email) {
        res.status(400).json({
          success: false,
          message: '用户名、邮箱不能为空，密码长度需为6-128位',
        })
        return
      }

      const user = await userService.createUser(
        input,
        req.user
      )

      await writeAuditLog(req, {
        category: 'user',
        action: 'user.create',
        status: 'success',
        organizationId: (user as any).organizationId,
        targetType: 'user',
        targetId: String((user as any)._id),
        summary: `创建用户 ${user.username}`,
        after: { username: user.username, email: user.email, role: user.role, status: user.status },
      })

      res.status(201).json({
        success: true,
        data: user,
      })
    } catch (error: any) {
      logger.error('Create user error:', error)
      res.status(400).json({
        success: false,
        message: error.message || '创建用户失败',
      })
    }
  }

  /**
   * PUT /api/users/:id
   * 更新用户信息
   */
  async updateUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const user = await userService.updateUser(
        req.params.id,
        sanitizeUserUpdateInput(req.body),
        req.user
      )

      await writeAuditLog(req, {
        category: 'user',
        action: 'user.update',
        status: 'success',
        organizationId: (user as any).organizationId,
        targetType: 'user',
        targetId: req.params.id,
        summary: `更新用户 ${user.username}`,
        after: { username: user.username, email: user.email, role: user.role, status: user.status },
      })

      res.json({
        success: true,
        data: user,
      })
    } catch (error: any) {
      logger.error('Update user error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '更新用户失败',
      })
    }
  }

  /**
   * DELETE /api/users/:id
   * 删除用户
   */
  async deleteUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      await userService.deleteUser(req.params.id, req.user)

      await writeAuditLog(req, {
        category: 'user',
        action: 'user.delete',
        status: 'success',
        targetType: 'user',
        targetId: req.params.id,
        summary: '删除用户',
      })

      res.json({
        success: true,
        message: '用户删除成功',
      })
    } catch (error: any) {
      logger.error('Delete user error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '删除用户失败',
      })
    }
  }

  /**
   * PUT /api/users/:id/status
   * 更新用户状态
   */
  async updateUserStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const status = pickUserStatus(req.body?.status)

      if (!status) {
        res.status(400).json({
          success: false,
          message: '无效的状态值',
        })
        return
      }

      const user = await userService.updateUserStatus(
        req.params.id,
        status,
        req.user
      )

      await writeAuditLog(req, {
        category: 'user',
        action: 'user.update_status',
        status: 'success',
        organizationId: (user as any).organizationId,
        targetType: 'user',
        targetId: req.params.id,
        summary: `更新用户状态为 ${status}`,
        after: { status: user.status },
      })

      res.json({
        success: true,
        data: user,
      })
    } catch (error: any) {
      logger.error('Update user status error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '更新用户状态失败',
      })
    }
  }

  /**
   * POST /api/users/:id/reset-password
   * 重置用户密码
   */
  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const newPassword = pickSafePassword(req.body?.newPassword)

      if (!newPassword) {
        res.status(400).json({
          success: false,
          message: '新密码长度需为6-128位',
        })
        return
      }

      await userService.resetUserPassword(
        req.params.id,
        newPassword,
        req.user
      )

      await writeAuditLog(req, {
        category: 'user',
        action: 'user.reset_password',
        status: 'success',
        targetType: 'user',
        targetId: req.params.id,
        summary: '管理员重置用户密码',
      })

      res.json({
        success: true,
        message: '密码重置成功',
      })
    } catch (error: any) {
      logger.error('Reset password error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '重置密码失败',
      })
    }
  }
}

export default new UserController()
