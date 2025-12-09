"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const account_management_controller_1 = __importDefault(require("../controllers/account.management.controller"));
const auth_1 = require("../middlewares/auth");
const User_1 = require("../models/User");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// 获取账户列表（带组织和标签信息）
router.get('/accounts', account_management_controller_1.default.getAccounts.bind(account_management_controller_1.default));
// 获取未分配的账户（账户池） - 仅超级管理员
router.get('/unassigned', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), account_management_controller_1.default.getUnassignedAccounts.bind(account_management_controller_1.default));
// 添加账户标签
router.post('/accounts/:accountId/tags', account_management_controller_1.default.addTags.bind(account_management_controller_1.default));
// 移除账户标签
router.delete('/accounts/:accountId/tags', account_management_controller_1.default.removeTags.bind(account_management_controller_1.default));
// 更新账户备注
router.put('/accounts/:accountId/notes', account_management_controller_1.default.updateNotes.bind(account_management_controller_1.default));
// 将账户分配给组织 - 仅超级管理员
router.post('/assign', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), account_management_controller_1.default.assignToOrganization.bind(account_management_controller_1.default));
// 取消账户分配 - 仅超级管理员
router.post('/unassign', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN), account_management_controller_1.default.unassignFromOrganization.bind(account_management_controller_1.default));
// 创建账户分组
router.post('/groups', account_management_controller_1.default.createGroup.bind(account_management_controller_1.default));
// 获取分组列表
router.get('/groups', account_management_controller_1.default.getGroups.bind(account_management_controller_1.default));
// 获取账户统计信息
router.get('/stats', account_management_controller_1.default.getStats.bind(account_management_controller_1.default));
exports.default = router;
