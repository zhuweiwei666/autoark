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
const logger_1 = __importDefault(require("../utils/logger"));
const auth_service_1 = __importDefault(require("./auth.service"));
class UserService {
    /**
     * 获取用户列表（带权限控制）
     */
    async getUsers(currentUser, filters) {
        const query = {};
        // 超级管理员可以看到所有用户
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 可以添加额外的过滤条件
            if (filters?.organizationId) {
                query.organizationId = filters.organizationId;
            }
            if (filters?.role) {
                query.role = filters.role;
            }
            if (filters?.status) {
                query.status = filters.status;
            }
        }
        // 组织管理员只能看到自己组织的用户
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            query.organizationId = currentUser.organizationId;
        }
        // 普通成员只能看到自己
        else {
            query._id = currentUser.userId;
        }
        const users = await User_1.default.find(query)
            .select('-password')
            .populate('organizationId')
            .sort({ createdAt: -1 });
        return users;
    }
    /**
     * 获取单个用户详情
     */
    async getUserById(userId, currentUser) {
        const user = await User_1.default.findById(userId)
            .select('-password')
            .populate('organizationId');
        if (!user) {
            throw new Error('用户不存在');
        }
        // 权限检查
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 超级管理员可以查看所有用户
            return user;
        }
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            // 组织管理员只能查看自己组织的用户
            if (user.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权访问此用户');
            }
            return user;
        }
        else {
            // 普通成员只能查看自己
            if (user._id.toString() !== currentUser.userId) {
                throw new Error('无权访问此用户');
            }
            return user;
        }
    }
    /**
     * 创建用户
     */
    async createUser(data, currentUser) {
        // 权限检查
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 超级管理员可以创建任何角色的用户
            return auth_service_1.default.createUser(data, currentUser.userId);
        }
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            // 组织管理员只能在自己的组织内创建普通成员
            if (data.role !== User_1.UserRole.MEMBER) {
                throw new Error('组织管理员只能创建普通成员');
            }
            if (data.organizationId !== currentUser.organizationId) {
                throw new Error('只能在自己的组织内创建用户');
            }
            return auth_service_1.default.createUser(data, currentUser.userId);
        }
        else {
            throw new Error('权限不足');
        }
    }
    /**
     * 更新用户信息
     */
    async updateUser(userId, updates, currentUser) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new Error('用户不存在');
        }
        // 权限检查
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 超级管理员可以更新任何用户
        }
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            // 组织管理员只能更新自己组织的用户
            if (user.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权修改此用户');
            }
            // 组织管理员不能修改角色为超级管理员或组织管理员
            if (updates.role && updates.role !== User_1.UserRole.MEMBER) {
                throw new Error('无权修改用户角色');
            }
        }
        else {
            // 普通成员只能更新自己的基本信息
            if (user._id.toString() !== currentUser.userId) {
                throw new Error('无权修改此用户');
            }
            // 普通成员不能修改角色和组织
            delete updates.role;
            delete updates.organizationId;
        }
        // 不允许直接修改密码（需要通过专门的修改密码接口）
        delete updates.password;
        Object.assign(user, updates);
        await user.save();
        logger_1.default.info(`User ${user.username} updated`);
        return user;
    }
    /**
     * 删除用户
     */
    async deleteUser(userId, currentUser) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new Error('用户不存在');
        }
        // 权限检查
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 超级管理员可以删除任何用户
        }
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            // 组织管理员只能删除自己组织的普通成员
            if (user.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权删除此用户');
            }
            if (user.role !== User_1.UserRole.MEMBER) {
                throw new Error('无权删除管理员用户');
            }
        }
        else {
            throw new Error('权限不足');
        }
        await User_1.default.findByIdAndDelete(userId);
        logger_1.default.info(`User ${user.username} deleted`);
    }
    /**
     * 更新用户状态
     */
    async updateUserStatus(userId, status, currentUser) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new Error('用户不存在');
        }
        // 权限检查
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 超级管理员可以更新任何用户状态
        }
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            // 组织管理员只能更新自己组织的用户状态
            if (user.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权修改此用户状态');
            }
        }
        else {
            throw new Error('权限不足');
        }
        return auth_service_1.default.updateUserStatus(userId, status);
    }
    /**
     * 重置用户密码
     */
    async resetUserPassword(userId, newPassword, currentUser) {
        const user = await User_1.default.findById(userId);
        if (!user) {
            throw new Error('用户不存在');
        }
        // 权限检查
        if (currentUser.role === User_1.UserRole.SUPER_ADMIN) {
            // 超级管理员可以重置任何用户密码
        }
        else if (currentUser.role === User_1.UserRole.ORG_ADMIN) {
            // 组织管理员只能重置自己组织的用户密码
            if (user.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权重置此用户密码');
            }
        }
        else {
            throw new Error('权限不足');
        }
        await auth_service_1.default.resetPassword(userId, newPassword);
    }
}
exports.default = new UserService();
