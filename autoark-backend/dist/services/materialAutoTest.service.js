"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.materialAutoTestService = exports.AutoTestConfig = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const mongoose_1 = __importDefault(require("mongoose"));
const Material_1 = __importDefault(require("../models/Material"));
// import bulkAdService from './bulkAd.service'
const FbToken_1 = __importDefault(require("../models/FbToken"));
// 自动测试配置 Schema
const autoTestConfigSchema = new mongoose_1.default.Schema({
    enabled: { type: Boolean, default: false },
    name: { type: String, required: true },
    accountId: { type: String, required: true },
    accountName: { type: String },
    campaignName: { type: String, default: 'AutoTest_{materialName}_{date}' },
    dailyBudget: { type: Number, default: 20 },
    bidStrategy: { type: String, default: 'LOWEST_COST_WITHOUT_CAP' },
    targetingPackageId: { type: String },
    countries: [{ type: String }],
    ageMin: { type: Number, default: 18 },
    ageMax: { type: Number, default: 65 },
    pixelId: { type: String },
    appId: { type: String },
    optimizationGoal: { type: String, default: 'APP_INSTALLS' },
    materialTypes: [{ type: String, enum: ['image', 'video'] }],
    folders: [{ type: String }],
    tags: [{ type: String }],
    totalCreated: { type: Number, default: 0 },
    lastRunAt: { type: Date },
    createdBy: { type: String, required: true },
}, { timestamps: true });
exports.AutoTestConfig = mongoose_1.default.model('AutoTestConfig', autoTestConfigSchema);
class MaterialAutoTestService {
    /**
     * 获取所有自动测试配置
     */
    async getConfigs() {
        return exports.AutoTestConfig.find().sort({ createdAt: -1 }).lean();
    }
    /**
     * 获取单个配置
     */
    async getConfigById(id) {
        return exports.AutoTestConfig.findById(id).lean();
    }
    /**
     * 创建配置
     */
    async createConfig(data) {
        const config = new exports.AutoTestConfig(data);
        await config.save();
        logger_1.default.info(`[MaterialAutoTest] Created config: ${config.name}`);
        return config.toObject();
    }
    /**
     * 更新配置
     */
    async updateConfig(id, data) {
        return exports.AutoTestConfig.findByIdAndUpdate(id, data, { new: true }).lean();
    }
    /**
     * 删除配置
     */
    async deleteConfig(id) {
        const result = await exports.AutoTestConfig.findByIdAndDelete(id);
        return !!result;
    }
    /**
     * 检查素材是否需要自动测试
     */
    shouldAutoTest(material, config) {
        // 检查素材类型
        if (config.materialTypes && config.materialTypes.length > 0) {
            if (!config.materialTypes.includes(material.type)) {
                return false;
            }
        }
        // 检查文件夹
        if (config.folders && config.folders.length > 0) {
            if (!config.folders.includes(material.folder)) {
                return false;
            }
        }
        // 检查标签
        if (config.tags && config.tags.length > 0) {
            const materialTags = material.tags || [];
            const hasMatchingTag = config.tags.some(tag => materialTags.includes(tag));
            if (!hasMatchingTag) {
                return false;
            }
        }
        return true;
    }
    /**
     * 为素材创建测试广告
     */
    async createTestAd(materialId, configId) {
        const material = await Material_1.default.findById(materialId);
        if (!material) {
            throw new Error('Material not found');
        }
        // 获取配置
        let config = null;
        if (configId) {
            config = await this.getConfigById(configId);
        }
        else {
            // 查找第一个启用的配置
            config = await exports.AutoTestConfig.findOne({ enabled: true }).lean();
        }
        if (!config) {
            throw new Error('No auto test config available');
        }
        if (!this.shouldAutoTest(material, config)) {
            throw new Error('Material does not match auto test criteria');
        }
        // 获取账户 token
        const token = await FbToken_1.default.findOne({
            accounts: { $elemMatch: { accountId: config.accountId } },
            isValid: true,
        });
        if (!token) {
            throw new Error('No valid token for account');
        }
        // 构建广告创建参数
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const campaignName = (config.campaignName || 'AutoTest_{materialName}_{date}')
            .replace('{materialName}', material.name.split('.')[0])
            .replace('{date}', date);
        const adDraft = {
            accountId: config.accountId,
            campaignName,
            adsetName: `${campaignName}_adset`,
            adName: `${material.name}_${date}`,
            dailyBudget: config.dailyBudget,
            bidStrategy: config.bidStrategy,
            optimizationGoal: config.optimizationGoal || 'APP_INSTALLS',
            targeting: {
                countries: config.countries || ['US'],
                ageMin: config.ageMin || 18,
                ageMax: config.ageMax || 65,
            },
            pixelId: config.pixelId,
            appId: config.appId,
            materials: [materialId],
        };
        logger_1.default.info(`[MaterialAutoTest] Creating test ad for material: ${material.name}`);
        logger_1.default.info(`[MaterialAutoTest] Ad config: account=${config.accountId}, budget=$${config.dailyBudget}, campaign=${campaignName}`);
        // TODO: 使用批量广告服务创建广告
        // 目前只记录日志，后续完善实际创建逻辑
        // 需要：文案包、定向包、像素、应用等完整配置
        const result = {
            success: true,
            materialId: materialId,
            materialName: material.name,
            accountId: config.accountId,
            campaignName,
            adDraft,
            message: '测试广告配置已生成，等待手动确认创建',
        };
        // 更新统计
        await exports.AutoTestConfig.findByIdAndUpdate(config._id, {
            $inc: { totalCreated: 1 },
            lastRunAt: new Date(),
        });
        return result;
    }
    /**
     * 检查待测试的新素材
     * 每 10 分钟执行一次
     */
    async checkNewMaterials() {
        const configs = await exports.AutoTestConfig.find({ enabled: true });
        if (configs.length === 0) {
            return;
        }
        logger_1.default.info(`[MaterialAutoTest] Checking new materials for ${configs.length} configs...`);
        for (const config of configs) {
            try {
                // 查找最近 10 分钟上传且未测试的素材
                const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
                const query = {
                    status: 'uploaded',
                    createdAt: { $gte: tenMinutesAgo },
                    autoTestStatus: { $ne: 'tested' }, // 未测试过
                };
                // 应用筛选条件
                if (config.materialTypes && config.materialTypes.length > 0) {
                    query.type = { $in: config.materialTypes };
                }
                if (config.folders && config.folders.length > 0) {
                    query.folder = { $in: config.folders };
                }
                if (config.tags && config.tags.length > 0) {
                    query.tags = { $in: config.tags };
                }
                const materials = await Material_1.default.find(query).limit(5); // 每次最多 5 个
                for (const material of materials) {
                    try {
                        await this.createTestAd(material._id.toString(), config._id?.toString());
                        // 标记为已测试
                        await Material_1.default.findByIdAndUpdate(material._id, {
                            autoTestStatus: 'tested',
                            autoTestAt: new Date(),
                        });
                        logger_1.default.info(`[MaterialAutoTest] Created test ad for: ${material.name}`);
                    }
                    catch (error) {
                        logger_1.default.error(`[MaterialAutoTest] Failed to create test ad for ${material.name}: ${error.message}`);
                        // 标记为失败
                        await Material_1.default.findByIdAndUpdate(material._id, {
                            autoTestStatus: 'failed',
                            autoTestError: error.message,
                        });
                    }
                }
            }
            catch (error) {
                logger_1.default.error(`[MaterialAutoTest] Config ${config.name} check failed: ${error.message}`);
            }
        }
    }
}
exports.materialAutoTestService = new MaterialAutoTestService();
exports.default = exports.materialAutoTestService;
