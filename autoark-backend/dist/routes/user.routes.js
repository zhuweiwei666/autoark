"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = __importDefault(require("../controllers/user.controller"));
const auth_1 = require("../middlewares/auth");
const User_1 = require("../models/User");
const router = (0, express_1.Router)();
// 所有路由都需要认证
router.use(auth_1.authenticate);
// 获取用户列表（所有登录用户都可以，但返回数据根据权限过滤）
router.get('/', user_controller_1.default.getUsers.bind(user_controller_1.default));
// 获取用户详情
router.get('/:id', user_controller_1.default.getUserById.bind(user_controller_1.default));
// 创建用户（超级管理员和组织管理员）
router.post('/', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN, User_1.UserRole.ORG_ADMIN), user_controller_1.default.createUser.bind(user_controller_1.default));
// 更新用户信息
router.put('/:id', user_controller_1.default.updateUser.bind(user_controller_1.default));
// 删除用户（超级管理员和组织管理员）
router.delete('/:id', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN, User_1.UserRole.ORG_ADMIN), user_controller_1.default.deleteUser.bind(user_controller_1.default));
// 更新用户状态（超级管理员和组织管理员）
router.put('/:id/status', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN, User_1.UserRole.ORG_ADMIN), user_controller_1.default.updateUserStatus.bind(user_controller_1.default));
// 重置用户密码（超级管理员和组织管理员）
router.post('/:id/reset-password', (0, auth_1.authorize)(User_1.UserRole.SUPER_ADMIN, User_1.UserRole.ORG_ADMIN), user_controller_1.default.resetPassword.bind(user_controller_1.default));
exports.default = router;
