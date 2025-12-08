"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const auth_service_1 = __importDefault(require("../services/auth.service"));
const logger_1 = __importDefault(require("../utils/logger"));
class AuthController {
    /**
     * POST /api/auth/login
     * 用户登录
     */
    async login(req, res) {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                res.status(400).json({
                    success: false,
                    message: '用户名和密码不能为空',
                });
                return;
            }
            const result = await auth_service_1.default.login({ username, password });
            res.json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            logger_1.default.error('Login error:', error);
            res.status(401).json({
                success: false,
                message: error.message || '登录失败',
            });
        }
    }
    /**
     * POST /api/auth/logout
     * 用户登出（前端删除 token）
     */
    async logout(req, res) {
        res.json({
            success: true,
            message: '登出成功',
        });
    }
    /**
     * GET /api/auth/me
     * 获取当前用户信息
     */
    async getCurrentUser(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    message: '未认证',
                });
                return;
            }
            const user = await auth_service_1.default.getCurrentUser(req.user.userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: '用户不存在',
                });
                return;
            }
            res.json({
                success: true,
                data: user,
            });
        }
        catch (error) {
            logger_1.default.error('Get current user error:', error);
            res.status(500).json({
                success: false,
                message: error.message || '获取用户信息失败',
            });
        }
    }
    /**
     * POST /api/auth/change-password
     * 修改密码
     */
    async changePassword(req, res) {
        try {
            if (!req.user) {
                res.status(401).json({
                    success: false,
                    message: '未认证',
                });
                return;
            }
            const { oldPassword, newPassword } = req.body;
            if (!oldPassword || !newPassword) {
                res.status(400).json({
                    success: false,
                    message: '旧密码和新密码不能为空',
                });
                return;
            }
            if (newPassword.length < 6) {
                res.status(400).json({
                    success: false,
                    message: '新密码长度不能少于6位',
                });
                return;
            }
            await auth_service_1.default.changePassword(req.user.userId, oldPassword, newPassword);
            res.json({
                success: true,
                message: '密码修改成功',
            });
        }
        catch (error) {
            logger_1.default.error('Change password error:', error);
            res.status(400).json({
                success: false,
                message: error.message || '修改密码失败',
            });
        }
    }
}
exports.default = new AuthController();
