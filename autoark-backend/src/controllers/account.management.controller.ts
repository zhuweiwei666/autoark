import { Request, Response } from 'express'
import accountManagementService from '../services/account.management.service'
import logger from '../utils/logger'

class AccountManagementController {
  /**
   * GET /api/account-management/accounts
   * 获取账户列表（带组织和标签）
   */
  async getAccounts(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const filters = {
        organizationId: req.query.organizationId as string,
        tags: req.query.tags,
        groupId: req.query.groupId as string,
        unassigned: req.query.unassigned as string,
      }

      const accounts = await accountManagementService.getAccounts(req.user, filters)

      res.json({
        success: true,
        data: accounts,
      })
    } catch (error: any) {
      logger.error('Get accounts error:', error)
      res.status(500).json({
        success: false,
        message: error.message || '获取账户列表失败',
      })
    }
  }

  /**
   * GET /api/account-management/unassigned
   * 获取未分配的账户（账户池）
   */
  async getUnassignedAccounts(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const accounts = await accountManagementService.getUnassignedAccounts(req.user)

      res.json({
        success: true,
        data: accounts,
      })
    } catch (error: any) {
      logger.error('Get unassigned accounts error:', error)
      res.status(error.message.includes('权限') ? 403 : 500).json({
        success: false,
        message: error.message || '获取账户池失败',
      })
    }
  }

  /**
   * POST /api/account-management/accounts/:accountId/tags
   * 添加账户标签
   */
  async addTags(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { accountId } = req.params
      const { tags } = req.body

      if (!tags || !Array.isArray(tags) || tags.length === 0) {
        res.status(400).json({
          success: false,
          message: '标签不能为空',
        })
        return
      }

      const account = await accountManagementService.addTags(
        accountId,
        tags,
        req.user
      )

      res.json({
        success: true,
        data: account,
      })
    } catch (error: any) {
      logger.error('Add tags error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '添加标签失败',
      })
    }
  }

  /**
   * DELETE /api/account-management/accounts/:accountId/tags
   * 移除账户标签
   */
  async removeTags(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { accountId } = req.params
      const { tags } = req.body

      if (!tags || !Array.isArray(tags)) {
        res.status(400).json({
          success: false,
          message: '标签格式错误',
        })
        return
      }

      const account = await accountManagementService.removeTags(
        accountId,
        tags,
        req.user
      )

      res.json({
        success: true,
        data: account,
      })
    } catch (error: any) {
      logger.error('Remove tags error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '移除标签失败',
      })
    }
  }

  /**
   * POST /api/account-management/assign
   * 将账户分配给组织
   */
  async assignToOrganization(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { accountIds, organizationId } = req.body

      if (!accountIds || !Array.isArray(accountIds) || !organizationId) {
        res.status(400).json({
          success: false,
          message: '账户ID列表和组织ID不能为空',
        })
        return
      }

      const count = await accountManagementService.assignToOrganization(
        accountIds,
        organizationId,
        req.user
      )

      res.json({
        success: true,
        message: `成功分配 ${count} 个账户`,
        data: { count },
      })
    } catch (error: any) {
      logger.error('Assign accounts error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '分配账户失败',
      })
    }
  }

  /**
   * POST /api/account-management/unassign
   * 取消账户分配（回收到账户池）
   */
  async unassignFromOrganization(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { accountIds } = req.body

      if (!accountIds || !Array.isArray(accountIds)) {
        res.status(400).json({
          success: false,
          message: '账户ID列表不能为空',
        })
        return
      }

      const count = await accountManagementService.unassignFromOrganization(
        accountIds,
        req.user
      )

      res.json({
        success: true,
        message: `成功回收 ${count} 个账户`,
        data: { count },
      })
    } catch (error: any) {
      logger.error('Unassign accounts error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '取消分配失败',
      })
    }
  }

  /**
   * POST /api/account-management/groups
   * 创建账户分组
   */
  async createGroup(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { name, description, color, organizationId, accounts } = req.body

      if (!name) {
        res.status(400).json({
          success: false,
          message: '分组名称不能为空',
        })
        return
      }

      const group = await accountManagementService.createGroup(
        { name, description, color, organizationId, accounts },
        req.user
      )

      res.status(201).json({
        success: true,
        data: group,
      })
    } catch (error: any) {
      logger.error('Create group error:', error)
      res.status(400).json({
        success: false,
        message: error.message || '创建分组失败',
      })
    }
  }

  /**
   * GET /api/account-management/groups
   * 获取分组列表
   */
  async getGroups(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const filters = {
        organizationId: req.query.organizationId as string,
      }

      const groups = await accountManagementService.getGroups(req.user, filters)

      res.json({
        success: true,
        data: groups,
      })
    } catch (error: any) {
      logger.error('Get groups error:', error)
      res.status(500).json({
        success: false,
        message: error.message || '获取分组列表失败',
      })
    }
  }

  /**
   * PUT /api/account-management/accounts/:accountId/notes
   * 更新账户备注
   */
  async updateNotes(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { accountId } = req.params
      const { notes } = req.body

      const account = await accountManagementService.updateAccountNotes(
        accountId,
        notes || '',
        req.user
      )

      res.json({
        success: true,
        data: account,
      })
    } catch (error: any) {
      logger.error('Update notes error:', error)
      res.status(error.message.includes('无权') ? 403 : 400).json({
        success: false,
        message: error.message || '更新备注失败',
      })
    }
  }

  /**
   * GET /api/account-management/stats
   * 获取账户统计信息
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const stats = await accountManagementService.getAccountStats(req.user)

      res.json({
        success: true,
        data: stats,
      })
    } catch (error: any) {
      logger.error('Get stats error:', error)
      res.status(500).json({
        success: false,
        message: error.message || '获取统计信息失败',
      })
    }
  }
}

export default new AccountManagementController()
