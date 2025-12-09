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
const mongoose_1 = __importDefault(require("mongoose"));
const Organization_1 = __importStar(require("../models/Organization"));
const User_1 = __importStar(require("../models/User"));
const logger_1 = __importDefault(require("../utils/logger"));
const auth_service_1 = __importDefault(require("./auth.service"));
class OrganizationService {
    /**
     * 获取组织列表
     */
    async getOrganizations(currentUser, filters) {
        // 只有超级管理员可以查看所有组织
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('权限不足');
        }
        const query = {};
        if (filters?.status) {
            query.status = filters.status;
        }
        const organizations = await Organization_1.default.find(query)
            .populate('adminId', '-password')
            .populate('createdBy', '-password')
            .sort({ createdAt: -1 });
        return organizations;
    }
    /**
     * 获取单个组织详情
     */
    async getOrganizationById(organizationId, currentUser) {
        const organization = await Organization_1.default.findById(organizationId)
            .populate('adminId', '-password')
            .populate('createdBy', '-password');
        if (!organization) {
            throw new Error('组织不存在');
        }
        // 权限检查：超级管理员或该组织的成员可以查看
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN &&
            currentUser.organizationId !== organizationId) {
            throw new Error('无权访问此组织');
        }
        return organization;
    }
    /**
     * 创建组织
     */
    async createOrganization(data, currentUser) {
        // 只有超级管理员可以创建组织
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('权限不足');
        }
        // 检查组织名是否已存在
        const existingOrg = await Organization_1.default.findOne({ name: data.name });
        if (existingOrg) {
            throw new Error('组织名称已存在');
        }
        // 检查管理员用户名和邮箱是否已存在
        const existingUser = await User_1.default.findOne({
            $or: [{ username: data.adminUsername }, { email: data.adminEmail }],
        });
        if (existingUser) {
            throw new Error('管理员用户名或邮箱已存在');
        }
        // 先创建一个临时的占位组织 ID
        const tempOrgId = new mongoose_1.default.Types.ObjectId();
        // 创建组织管理员（使用临时 ID，跳过组织验证）
        const admin = await auth_service_1.default.createUser({
            username: data.adminUsername,
            password: data.adminPassword,
            email: data.adminEmail,
            role: User_1.UserRole.ORG_ADMIN,
            organizationId: tempOrgId.toString(),
            skipOrgValidation: true, // 跳过组织存在性验证
        }, currentUser.userId);
        try {
            // 创建组织（使用真实的管理员 ID）
            const organization = new Organization_1.default({
                _id: tempOrgId,
                name: data.name,
                description: data.description,
                adminId: admin._id,
                status: Organization_1.OrganizationStatus.ACTIVE,
                settings: data.settings,
                createdBy: currentUser.userId,
            });
            await organization.save();
            logger_1.default.info(`Organization ${data.name} created with admin ${data.adminUsername}`);
            return {
                organization,
                admin: admin.toJSON(),
            };
        }
        catch (error) {
            // 如果创建组织失败，删除已创建的管理员
            await User_1.default.findByIdAndDelete(admin._id);
            throw error;
        }
    }
    /**
     * 更新组织信息
     */
    async updateOrganization(organizationId, updates, currentUser) {
        // 只有超级管理员可以更新组织
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('权限不足');
        }
        const organization = await Organization_1.default.findById(organizationId);
        if (!organization) {
            throw new Error('组织不存在');
        }
        // 不允许直接修改 adminId 和 createdBy
        delete updates.adminId;
        delete updates.createdBy;
        Object.assign(organization, updates);
        await organization.save();
        logger_1.default.info(`Organization ${organization.name} updated`);
        return organization;
    }
    /**
     * 删除组织
     */
    async deleteOrganization(organizationId, currentUser) {
        // 只有超级管理员可以删除组织
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('权限不足');
        }
        const organization = await Organization_1.default.findById(organizationId);
        if (!organization) {
            throw new Error('组织不存在');
        }
        // 检查组织下是否还有用户
        const userCount = await User_1.default.countDocuments({ organizationId });
        if (userCount > 0) {
            throw new Error('组织下还有用户，无法删除');
        }
        await Organization_1.default.findByIdAndDelete(organizationId);
        logger_1.default.info(`Organization ${organization.name} deleted`);
    }
    /**
     * 更新组织状态
     */
    async updateOrganizationStatus(organizationId, status, currentUser) {
        // 只有超级管理员可以更新组织状态
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('权限不足');
        }
        const organization = await Organization_1.default.findByIdAndUpdate(organizationId, { status }, { new: true });
        if (!organization) {
            throw new Error('组织不存在');
        }
        logger_1.default.info(`Organization ${organization.name} status updated to ${status}`);
        return organization;
    }
    /**
     * 获取组织的成员列表
     */
    async getOrganizationMembers(organizationId, currentUser) {
        // 权限检查：超级管理员或该组织的管理员可以查看
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN &&
            (currentUser.role !== User_1.UserRole.ORG_ADMIN ||
                currentUser.organizationId !== organizationId)) {
            throw new Error('权限不足');
        }
        const members = await User_1.default.find({ organizationId })
            .select('-password')
            .sort({ createdAt: -1 });
        return members;
    }
    /**
     * 转移组织管理员
     */
    async transferAdmin(organizationId, newAdminId, currentUser) {
        // 只有超级管理员可以转移组织管理员
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('权限不足');
        }
        const organization = await Organization_1.default.findById(organizationId);
        if (!organization) {
            throw new Error('组织不存在');
        }
        const newAdmin = await User_1.default.findById(newAdminId);
        if (!newAdmin) {
            throw new Error('新管理员不存在');
        }
        if (newAdmin.organizationId?.toString() !== organizationId) {
            throw new Error('新管理员不属于此组织');
        }
        // 更新新管理员的角色
        newAdmin.role = User_1.UserRole.ORG_ADMIN;
        await newAdmin.save();
        // 如果有旧管理员，将其角色改为普通成员
        if (organization.adminId) {
            const oldAdmin = await User_1.default.findById(organization.adminId);
            if (oldAdmin) {
                oldAdmin.role = User_1.UserRole.MEMBER;
                await oldAdmin.save();
            }
        }
        // 更新组织的管理员
        organization.adminId = newAdmin._id;
        await organization.save();
        logger_1.default.info(`Organization ${organization.name} admin transferred to ${newAdmin.username}`);
        return organization;
    }
}
exports.default = new OrganizationService();
