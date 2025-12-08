"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const User_1 = __importStar(require("../models/User"));
const Organization_1 = __importDefault(require("../models/Organization"));
const jwt_1 = require("../utils/jwt");
const logger_1 = __importDefault(require("../utils/logger"));
class AuthService {
    /**
     * 用户登录
     */
    async login(credentials) {
        const { username, password } = credentials;
        // 查找用户
        const user = await User_1.default.findOne({ username }).populate('organizationId');
        if (!user) {
            throw new Error('用户名或密码错误');
        }
        // 检查用户状态
        if (user.status !== User_1.UserStatus.ACTIVE) {
            throw new Error('账号已被禁用或冻结');
        }
        // 验证密码
        const isPasswordValid = await user.comparePassword(password);
        if (!isPasswordValid) {
            throw new Error('用户名或密码错误');
        }
        // 更新最后登录时间
        user.lastLoginAt = new Date();
        await user.save();
        // 生成 token
        const token = (0, jwt_1.generateToken)(user);
        logger_1.default.info(`User ${username} logged in successfully`);
        return {
            user: user.toJSON(),
            token,
        };
    }
    /**
     * 创建用户
     */
    async createUser(data, createdBy) {
        const { username, password, email, role, organizationId } = data;
        // 检查用户名是否已存在
        const existingUser = await User_1.default.findOne({
            $or: [{ username }, { email }],
        });
        if (existingUser) {
            throw new Error('用户名或邮箱已存在');
        }
        // 如果不是超级管理员，必须提供 organizationId
        if (role !== User_1.UserRole.SUPER_ADMIN && !organizationId) {
            throw new Error('必须指定所属组织');
        }
        // 验证组织是否存在
        if (organizationId) {
            const organization = await Organization_1.default.findById(organizationId);
            if (!organization) {
                throw new Error('组织不存在');
            }
        }
        // 创建用户
        const user = new User_1.default({
            username,
            password,
            email,
            role: role || User_1.UserRole.MEMBER,
            organizationId,
            status: User_1.UserStatus.ACTIVE,
            createdBy,
        });
        await user.save();
        logger_1.default.info(`User ${username} created successfully`);
        return user;
    }
    /**
     * 修改密码
     */
    async changePassword(userId, oldPassword, newPassword) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new Error('用户不存在');
        }
        // 验证旧密码
        const isPasswordValid = await user.comparePassword(oldPassword);
        if (!isPasswordValid) {
            throw new Error('原密码错误');
        }
        // 更新密码
        user.password = newPassword;
        await user.save();
        logger_1.default.info(`User ${user.username} changed password`);
    }
    /**
     * 重置密码（管理员操作）
     */
    async resetPassword(userId, newPassword) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new Error('用户不存在');
        }
        user.password = newPassword;
        await user.save();
        logger_1.default.info(`Password reset for user ${user.username}`);
    }
    /**
     * 获取当前用户信息
     */
    async getCurrentUser(userId) {
        const user = await User_1.default.findById(userId)
            .select('-password')
            .populate('organizationId');
        return user;
    }
    /**
     * 更新用户状态
     */
    async updateUserStatus(userId, status) {
        const user = await User_1.default.findByIdAndUpdate(userId, { status }, { new: true }).select('-password');
        if (!user) {
            throw new Error('用户不存在');
        }
        logger_1.default.info(`User ${user.username} status updated to ${status}`);
        return user;
    }
}
exports.default = new AuthService();
