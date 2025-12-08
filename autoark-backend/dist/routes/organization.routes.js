"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const organization_controller_1 = __importDefault(require("../controllers/organization.controller"));
const auth_1 = require("../middlewares/auth");
const User_1 = require("../models/User");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// 获取组织列表（仅超级管理员）
router.get('/', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), organization_controller_1.default.getOrganizations.bind(organization_controller_1.default));
// 获取组织详情（超级管理员或组织成员）
router.get('/:id', organization_controller_1.default.getOrganizationById.bind(organization_controller_1.default));
// 创建组织（仅超级管理员）
router.post('/', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), organization_controller_1.default.createOrganization.bind(organization_controller_1.default));
// 更新组织信息（仅超级管理员）
router.put('/:id', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), organization_controller_1.default.updateOrganization.bind(organization_controller_1.default));
// 删除组织（仅超级管理员）
router.delete('/:id', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), organization_controller_1.default.deleteOrganization.bind(organization_controller_1.default));
// 更新组织状态（仅超级管理员）
router.put('/:id/status', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), organization_controller_1.default.updateOrganizationStatus.bind(organization_controller_1.default));
// 获取组织成员列表（超级管理员或组织管理员）
router.get('/:id/members', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN, User_1.UserRole.ORG_ADMIN), organization_controller_1.default.getOrganizationMembers.bind(organization_controller_1.default));
// 转移组织管理员（仅超级管理员）
router.post('/:id/transfer-admin', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), organization_controller_1.default.transferAdmin.bind(organization_controller_1.default));
exports.default = router;
