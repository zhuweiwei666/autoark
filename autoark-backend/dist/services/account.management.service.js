"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Account_1 = __importDefault(require("../models/Account"));
const AccountGroup_1 = __importDefault(require("../models/AccountGroup"));
const Organization_1 = __importDefault(require("../models/Organization"));
const User_1 = require("../models/User");
const logger_1 = __importDefault(require("../utils/logger"));
class AccountManagementService {
    /**
     * 获取账户列表（带组织和标签信息）
     */
    async getAccounts(currentUser, filters) {
        const query = {};
        // 超级管理员可以看到所有账户
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            query.organizationId = currentUser.organizationId;
        }
        // 应用过滤条件
        if (filters?.organizationId) {
            query.organizationId = filters.organizationId;
        }
        if (filters?.tags) {
            query.tags = { $in: Array.isArray(filters.tags) ? filters.tags : [filters.tags] };
        }
        if (filters?.groupId) {
            query.groupId = filters.groupId;
        }
        if (filters?.unassigned === 'true') {
            query.organizationId = null;
        }
        const accounts = await Account_1.default.find(query)
            .populate('organizationId', 'name')
            .populate('groupId', 'name color')
            .populate('createdBy', 'username')
            .populate('assignedBy', 'username')
            .sort({ createdAt: -1 });
        return accounts;
    }
    /**
     * 为账户添加标签
     */
    async addTags(accountId, tags, currentUser) {
        const account = await Account_1.default.findOne({ accountId });
        if (!account) {
            throw new Error('账户不存在');
        }
        // 权限检查：超级管理员或账户所属组织的管理员
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            if (account.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权修改此账户');
            }
        }
        // 添加标签（去重）
        const existingTags = account.tags || [];
        account.tags = [...new Set([...existingTags, ...tags])];
        await account.save();
        logger_1.default.info(`Tags added to account ${accountId}: ${tags.join(', ')}`);
        return account;
    }
    /**
     * 移除账户标签
     */
    async removeTags(accountId, tags, currentUser) {
        const account = await Account_1.default.findOne({ accountId });
        if (!account) {
            throw new Error('账户不存在');
        }
        // 权限检查
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            if (account.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权修改此账户');
            }
        }
        // 移除标签
        account.tags = (account.tags || []).filter(tag => !tags.includes(tag));
        await account.save();
        return account;
    }
    /**
     * 将账户分配给组织
     */
    async assignToOrganization(accountIds, organizationId, currentUser) {
        // 只有超级管理员可以分配账户
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('只有超级管理员可以分配账户');
        }
        // 验证组织是否存在
        const organization = await Organization_1.default.findById(organizationId);
        if (!organization) {
            throw new Error('组织不存在');
        }
        // 批量更新账户
        const result = await Account_1.default.updateMany({ accountId: { $in: accountIds } }, {
            $set: {
                organizationId,
                assignedBy: currentUser.userId,
                assignedAt: new Date(),
            },
        });
        logger_1.default.info(`Assigned ${result.modifiedCount} accounts to organization ${organization.name}`);
        return result.modifiedCount;
    }
    /**
     * 取消账户的组织分配（回收到账户池）
     */
    async unassignFromOrganization(accountIds, currentUser) {
        // 只有超级管理员可以取消分配
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('只有超级管理员可以取消分配');
        }
        const result = await Account_1.default.updateMany({ accountId: { $in: accountIds } }, {
            $unset: {
                organizationId: '',
                assignedBy: '',
                assignedAt: '',
            },
        });
        logger_1.default.info(`Unassigned ${result.modifiedCount} accounts from organizations`);
        return result.modifiedCount;
    }
    /**
     * 创建账户分组
     */
    async createGroup(data, currentUser) {
        // 检查分组名是否已存在
        const existingGroup = await AccountGroup_1.default.findOne({ name: data.name });
        if (existingGroup) {
            throw new Error('分组名称已存在');
        }
        const group = new AccountGroup_1.default({
            name: data.name,
            description: data.description,
            color: data.color || '#3B82F6',
            organizationId: data.organizationId,
            accounts: data.accounts || [],
            createdBy: currentUser.userId,
        });
        await group.save();
        // 更新账户的 groupId
        if (data.accounts && data.accounts.length > 0) {
            await Account_1.default.updateMany({ accountId: { $in: data.accounts } }, { $set: { groupId: group._id } });
        }
        logger_1.default.info(`Account group ${data.name} created`);
        return group;
    }
    /**
     * 获取分组列表
     */
    async getGroups(currentUser, filters) {
        const query = {};
        // 非超级管理员只能看到自己组织的分组
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            query.organizationId = currentUser.organizationId;
        }
        if (filters?.organizationId) {
            query.organizationId = filters.organizationId;
        }
        const groups = await AccountGroup_1.default.find(query)
            .populate('organizationId', 'name')
            .populate('createdBy', 'username')
            .sort({ createdAt: -1 });
        return groups;
    }
    /**
     * 批量更新账户备注
     */
    async updateAccountNotes(accountId, notes, currentUser) {
        const account = await Account_1.default.findOne({ accountId });
        if (!account) {
            throw new Error('账户不存在');
        }
        // 权限检查
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            if (account.organizationId?.toString() !== currentUser.organizationId) {
                throw new Error('无权修改此账户');
            }
        }
        account.notes = notes;
        await account.save();
        return account;
    }
    /**
     * 获取未分配的账户（账户池）
     */
    async getUnassignedAccounts(currentUser) {
        // 只有超级管理员可以查看账户池
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            throw new Error('只有超级管理员可以查看账户池');
        }
        const accounts = await Account_1.default.find({
            $or: [
                { organizationId: null },
                { organizationId: { $exists: false } },
            ],
        })
            .populate('groupId', 'name color')
            .sort({ createdAt: -1 });
        return accounts;
    }
    /**
     * 获取账户统计信息
     */
    async getAccountStats(currentUser) {
        const query = {};
        if (currentUser.role !== User_1.UserRole.SUPER_ADMIN) {
            query.organizationId = currentUser.organizationId;
        }
        const total = await Account_1.default.countDocuments(query);
        const unassigned = await Account_1.default.countDocuments({
            organizationId: null,
        });
        // 按组织统计
        const byOrganization = await Account_1.default.aggregate([
            { $match: query },
            {
                $group: {
                    _id: '$organizationId',
                    count: { $sum: 1 },
                },
            },
            {
                $lookup: {
                    from: 'organizations',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'organization',
                },
            },
        ]);
        // 按标签统计
        const byTags = await Account_1.default.aggregate([
            { $match: query },
            { $unwind: '$tags' },
            {
                $group: {
                    _id: '$tags',
                    count: { $sum: 1 },
                },
            },
            { $sort: { count: -1 } },
        ]);
        return {
            total,
            unassigned,
            byOrganization,
            byTags,
        };
    }
}
exports.default = new AccountManagementService();
