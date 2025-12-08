import { Request, Response } from 'express'
import userService from '../services/user.service'
import { UserRole, UserStatus } from '../models/User'
import logger from '../utils/logger'

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

      const filters = {
        organizationId: req.query.organizationId as string,
        role: req.query.role as UserRole,
        status: req.query.status as UserStatus,
      }

      const users = await userService.getUsers(req.user, filters)

      res.json({
        success: true,
        data: users,
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

      const { username, password, email, role, organizationId } = req.body

      if (!username || !password || !email) {
        res.status(400).json({
          success: false,
          message: '用户名、密码和邮箱不能为空',
        })
        return
      }

      const user = await userService.createUser(
        { username, password, email, role, organizationId },
        req.user
      )

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
        req.body,
        req.user
      )

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

      const { status } = req.body

      if (!status || !Object.values(UserStatus).includes(status)) {
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

      const { newPassword } = req.body

      if (!newPassword || newPassword.length < 6) {
        res.status(400).json({
          success: false,
          message: '新密码长度不能少于6位',
        })
        return
      }

      await userService.resetUserPassword(
        req.params.id,
        newPassword,
        req.user
      )

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
