"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const organization_service_1 = __importDefault(require("../services/organization.service"));
const Organization_1 = require("../models/Organization");
const logger_1 = __importDefault(require("../utils/logger"));
class OrganizationController {
    /**
     * GET /api/organizations
     * 获取组织列表
     */
    async getOrganizations(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const filters = {
                status: req.query.status,
            };
            const organizations = await organization_service_1.default.getOrganizations(req.user, filters);
            res.json({
                success: true,
                data: organizations,
            });
        }
        catch (error) {
            logger_1.default.error('Get organizations error:', error);
            res.status(error.message.includes('权限') ? 403 : 500).json({
                success: false,
                message: error.message || '获取组织列表失败',
            });
        }
    }
    /**
     * GET /api/organizations/:id
     * 获取组织详情
     */
    async getOrganizationById(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const organization = await organization_service_1.default.getOrganizationById(req.params.id, req.user);
            res.json({
                success: true,
                data: organization,
            });
        }
        catch (error) {
            logger_1.default.error('Get organization by id error:', error);
            res.status(error.message.includes('无权') ? 403 : 404).json({
                success: false,
                message: error.message || '获取组织信息失败',
            });
        }
    }
    /**
     * POST /api/organizations
     * 创建组织
     */
    async createOrganization(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const { name, description, adminUsername, adminPassword, adminEmail, settings, } = req.body;
            if (!name || !adminUsername || !adminPassword || !adminEmail) {
                res.status(400).json({
                    success: false,
                    message: '组织名称、管理员用户名、密码和邮箱不能为空',
                });
                return;
            }
            const result = await organization_service_1.default.createOrganization({
                name,
                description,
                adminUsername,
                adminPassword,
                adminEmail,
                settings,
            }, req.user);
            res.status(201).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            logger_1.default.error('Create organization error:', error);
            res.status(error.message.includes('权限') ? 403 : 400).json({
                success: false,
                message: error.message || '创建组织失败',
            });
        }
    }
    /**
     * PUT /api/organizations/:id
     * 更新组织信息
     */
    async updateOrganization(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const organization = await organization_service_1.default.updateOrganization(req.params.id, req.body, req.user);
            res.json({
                success: true,
                data: organization,
            });
        }
        catch (error) {
            logger_1.default.error('Update organization error:', error);
            res.status(error.message.includes('权限') ? 403 : 400).json({
                success: false,
                message: error.message || '更新组织失败',
            });
        }
    }
    /**
     * DELETE /api/organizations/:id
     * 删除组织
     */
    async deleteOrganization(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            await organization_service_1.default.deleteOrganization(req.params.id, req.user);
            res.json({
                success: true,
                message: '组织删除成功',
            });
        }
        catch (error) {
            logger_1.default.error('Delete organization error:', error);
            res.status(error.message.includes('权限') ? 403 : 400).json({
                success: false,
                message: error.message || '删除组织失败',
            });
        }
    }
    /**
     * PUT /api/organizations/:id/status
     * 更新组织状态
     */
    async updateOrganizationStatus(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const { status } = req.body;
            if (!status || !Object.values(Organization_1.OrganizationStatus).includes(status)) {
                res.status(400).json({
                    success: false,
                    message: '无效的状态值',
                });
                return;
            }
            const organization = await organization_service_1.default.updateOrganizationStatus(req.params.id, status, req.user);
            res.json({
                success: true,
                data: organization,
            });
        }
        catch (error) {
            logger_1.default.error('Update organization status error:', error);
            res.status(error.message.includes('权限') ? 403 : 400).json({
                success: false,
                message: error.message || '更新组织状态失败',
            });
        }
    }
    /**
     * GET /api/organizations/:id/members
     * 获取组织成员列表
     */
    async getOrganizationMembers(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const members = await organization_service_1.default.getOrganizationMembers(req.params.id, req.user);
            res.json({
                success: true,
                data: members,
            });
        }
        catch (error) {
            logger_1.default.error('Get organization members error:', error);
            res.status(error.message.includes('权限') ? 403 : 500).json({
                success: false,
                message: error.message || '获取组织成员失败',
            });
        }
    }
    /**
     * POST /api/organizations/:id/transfer-admin
     * 转移组织管理员
     */
    async transferAdmin(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: '未认证' });
                return;
            }
            const { newAdminId } = req.body;
            if (!newAdminId) {
                res.status(400).json({
                    success: false,
                    message: '新管理员ID不能为空',
                });
                return;
            }
            const organization = await organization_service_1.default.transferAdmin(req.params.id, newAdminId, req.user);
            res.json({
                success: true,
                data: organization,
            });
        }
        catch (error) {
            logger_1.default.error('Transfer admin error:', error);
            res.status(error.message.includes('权限') ? 403 : 400).json({
                success: false,
                message: error.message || '转移管理员失败',
            });
        }
    }
}
exports.default = new OrganizationController();
