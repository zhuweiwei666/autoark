import { Request, Response } from 'express'
import authService from '../services/auth.service'
import logger from '../utils/logger'

class AuthController {
  /**
   * POST /api/auth/login
   * 用户登录
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body

      if (!username || !password) {
        res.status(400).json({
          success: false,
          message: '用户名和密码不能为空',
        })
        return
      }

      const result = await authService.login({ username, password })

      res.json({
        success: true,
        data: result,
      })
    } catch (error: any) {
      logger.error('Login error:', error)
      res.status(401).json({
        success: false,
        message: error.message || '登录失败',
      })
    }
  }

  /**
   * POST /api/auth/logout
   * 用户登出（前端删除 token）
   */
  async logout(req: Request, res: Response): Promise<void> {
    res.json({
      success: true,
      message: '登出成功',
    })
  }

  /**
   * GET /api/auth/me
   * 获取当前用户信息
   */
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: '未认证',
        })
        return
      }

      const user = await authService.getCurrentUser(req.user.userId)

      if (!user) {
        res.status(404).json({
          success: false,
          message: '用户不存在',
        })
        return
      }

      res.json({
        success: true,
        data: user,
      })
    } catch (error: any) {
      logger.error('Get current user error:', error)
      res.status(500).json({
        success: false,
        message: error.message || '获取用户信息失败',
      })
    }
  }

  /**
   * POST /api/auth/change-password
   * 修改密码
   */
  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          success: false,
          message: '未认证',
        })
        return
      }

      const { oldPassword, newPassword } = req.body

      if (!oldPassword || !newPassword) {
        res.status(400).json({
          success: false,
          message: '旧密码和新密码不能为空',
        })
        return
      }

      if (newPassword.length < 6) {
        res.status(400).json({
          success: false,
          message: '新密码长度不能少于6位',
        })
        return
      }

      await authService.changePassword(
        req.user.userId,
        oldPassword,
        newPassword
      )

      res.json({
        success: true,
        message: '密码修改成功',
      })
    } catch (error: any) {
      logger.error('Change password error:', error)
      res.status(400).json({
        success: false,
        message: error.message || '修改密码失败',
      })
    }
  }
}

export default new AuthController()
