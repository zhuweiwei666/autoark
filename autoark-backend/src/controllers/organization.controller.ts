import { Request, Response } from 'express'
import organizationService from '../services/organization.service'
import { OrganizationStatus } from '../models/Organization'
import logger from '../utils/logger'

class OrganizationController {
  /**
   * GET /api/organizations
   * 获取组织列表
   */
  async getOrganizations(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const filters = {
        status: req.query.status as OrganizationStatus,
      }

      const organizations = await organizationService.getOrganizations(
        req.user,
        filters
      )

      res.json({
        success: true,
        data: organizations,
      })
    } catch (error: any) {
      logger.error('Get organizations error:', error)
      res.status(error.message.includes('权限') ? 403 : 500).json({
        success: false,
        message: error.message || '获取组织列表失败',
      })
    }
  }

  /**
   * GET /api/organizations/:id
   * 获取组织详情
   */
  async getOrganizationById(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const organization = await organizationService.getOrganizationById(
        req.params.id,
        req.user
      )

      res.json({
        success: true,
        data: organization,
      })
    } catch (error: any) {
      logger.error('Get organization by id error:', error)
      res.status(error.message.includes('无权') ? 403 : 404).json({
        success: false,
        message: error.message || '获取组织信息失败',
      })
    }
  }

  /**
   * POST /api/organizations
   * 创建组织
   */
  async createOrganization(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const {
        name,
        description,
        adminUsername,
        adminPassword,
        adminEmail,
        settings,
      } = req.body

      if (!name || !adminUsername || !adminPassword || !adminEmail) {
        res.status(400).json({
          success: false,
          message: '组织名称、管理员用户名、密码和邮箱不能为空',
        })
        return
      }

      const result = await organizationService.createOrganization(
        {
          name,
          description,
          adminUsername,
          adminPassword,
          adminEmail,
          settings,
        },
        req.user
      )

      res.status(201).json({
        success: true,
        data: result,
      })
    } catch (error: any) {
      logger.error('Create organization error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '创建组织失败',
      })
    }
  }

  /**
   * PUT /api/organizations/:id
   * 更新组织信息
   */
  async updateOrganization(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const organization = await organizationService.updateOrganization(
        req.params.id,
        req.body,
        req.user
      )

      res.json({
        success: true,
        data: organization,
      })
    } catch (error: any) {
      logger.error('Update organization error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '更新组织失败',
      })
    }
  }

  /**
   * DELETE /api/organizations/:id
   * 删除组织
   */
  async deleteOrganization(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      await organizationService.deleteOrganization(req.params.id, req.user)

      res.json({
        success: true,
        message: '组织删除成功',
      })
    } catch (error: any) {
      logger.error('Delete organization error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '删除组织失败',
      })
    }
  }

  /**
   * PUT /api/organizations/:id/status
   * 更新组织状态
   */
  async updateOrganizationStatus(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { status } = req.body

      if (!status || !Object.values(OrganizationStatus).includes(status)) {
        res.status(400).json({
          success: false,
          message: '无效的状态值',
        })
        return
      }

      const organization = await organizationService.updateOrganizationStatus(
        req.params.id,
        status,
        req.user
      )

      res.json({
        success: true,
        data: organization,
      })
    } catch (error: any) {
      logger.error('Update organization status error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '更新组织状态失败',
      })
    }
  }

  /**
   * GET /api/organizations/:id/members
   * 获取组织成员列表
   */
  async getOrganizationMembers(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const members = await organizationService.getOrganizationMembers(
        req.params.id,
        req.user
      )

      res.json({
        success: true,
        data: members,
      })
    } catch (error: any) {
      logger.error('Get organization members error:', error)
      res.status(error.message.includes('权限') ? 403 : 500).json({
        success: false,
        message: error.message || '获取组织成员失败',
      })
    }
  }

  /**
   * POST /api/organizations/:id/transfer-admin
   * 转移组织管理员
   */
  async transferAdmin(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: '未认证' })
        return
      }

      const { newAdminId } = req.body

      if (!newAdminId) {
        res.status(400).json({
          success: false,
          message: '新管理员ID不能为空',
        })
        return
      }

      const organization = await organizationService.transferAdmin(
        req.params.id,
        newAdminId,
        req.user
      )

      res.json({
        success: true,
        data: organization,
      })
    } catch (error: any) {
      logger.error('Transfer admin error:', error)
      res.status(error.message.includes('权限') ? 403 : 400).json({
        success: false,
        message: error.message || '转移管理员失败',
      })
    }
  }
}

export default new OrganizationController()
