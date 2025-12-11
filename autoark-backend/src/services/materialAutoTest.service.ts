import logger from '../utils/logger'
import mongoose from 'mongoose'
import Material from '../models/Material'
import { bulkAdService } from './bulkAd.service'
import FbToken from '../models/FbToken'
import Account from '../models/Account'

/**
 * 🧪 素材自动测试服务
 * 
 * 当新素材上传后，自动创建测试广告
 * 
 * 配置项：
 * - 启用/禁用自动测试
 * - 默认测试账户
 * - 默认测试预算
 * - 默认定向包
 * - 默认像素/应用
 */

export interface AutoTestConfig {
  _id?: string
  enabled: boolean
  name: string
  
  // 测试账户
  accountId: string
  accountName?: string
  
  // 广告配置
  campaignName?: string        // 广告系列名称模板
  dailyBudget: number          // 日预算
  bidStrategy: string          // 出价策略
  
  // 定向
  targetingPackageId?: string  // 定向包ID
  countries?: string[]         // 国家
  ageMin?: number
  ageMax?: number
  
  // 转化
  pixelId?: string
  appId?: string
  optimizationGoal?: string
  
  // 筛选
  materialTypes?: ('image' | 'video')[]  // 只测试特定类型
  folders?: string[]                      // 只测试特定文件夹
  tags?: string[]                         // 只测试包含特定标签的素材
  
  // 统计
  totalCreated: number
  lastRunAt?: Date
  
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// 自动测试配置 Schema
const autoTestConfigSchema = new mongoose.Schema({
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
}, { timestamps: true })

export const AutoTestConfig = mongoose.model('AutoTestConfig', autoTestConfigSchema)

class MaterialAutoTestService {
  
  /**
   * 获取所有自动测试配置
   */
  async getConfigs(): Promise<AutoTestConfig[]> {
    return AutoTestConfig.find().sort({ createdAt: -1 }).lean()
  }
  
  /**
   * 获取单个配置
   */
  async getConfigById(id: string): Promise<AutoTestConfig | null> {
    return AutoTestConfig.findById(id).lean()
  }
  
  /**
   * 创建配置
   */
  async createConfig(data: Partial<AutoTestConfig>): Promise<AutoTestConfig> {
    const config = new AutoTestConfig(data)
    await config.save()
    logger.info(`[MaterialAutoTest] Created config: ${config.name}`)
    return config.toObject()
  }
  
  /**
   * 更新配置
   */
  async updateConfig(id: string, data: Partial<AutoTestConfig>): Promise<AutoTestConfig | null> {
    return AutoTestConfig.findByIdAndUpdate(id, data, { new: true }).lean()
  }
  
  /**
   * 删除配置
   */
  async deleteConfig(id: string): Promise<boolean> {
    const result = await AutoTestConfig.findByIdAndDelete(id)
    return !!result
  }
  
  /**
   * 检查素材是否需要自动测试
   */
  private shouldAutoTest(material: any, config: AutoTestConfig): boolean {
    // 检查素材类型
    if (config.materialTypes && config.materialTypes.length > 0) {
      if (!config.materialTypes.includes(material.type)) {
        return false
      }
    }
    
    // 检查文件夹
    if (config.folders && config.folders.length > 0) {
      if (!config.folders.includes(material.folder)) {
        return false
      }
    }
    
    // 检查标签
    if (config.tags && config.tags.length > 0) {
      const materialTags = material.tags || []
      const hasMatchingTag = config.tags.some(tag => materialTags.includes(tag))
      if (!hasMatchingTag) {
        return false
      }
    }
    
    return true
  }
  
  /**
   * 为素材创建测试广告
   */
  async createTestAd(materialId: string, configId?: string): Promise<any> {
    const material = await Material.findById(materialId)
    if (!material) {
      throw new Error('Material not found')
    }
    
    // 获取配置
    let config: AutoTestConfig | null = null
    if (configId) {
      config = await this.getConfigById(configId)
    } else {
      // 查找第一个启用的配置
      config = await AutoTestConfig.findOne({ enabled: true }).lean()
    }
    
    if (!config) {
      throw new Error('No auto test config available')
    }
    
    if (!this.shouldAutoTest(material, config)) {
      throw new Error('Material does not match auto test criteria')
    }
    
    // 获取账户 token
    const token = await FbToken.findOne({
      accounts: { $elemMatch: { accountId: config.accountId } },
      isValid: true,
    })
    
    if (!token) {
      throw new Error('No valid token for account')
    }
    
    // 构建广告创建参数
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '')
    const campaignName = (config.campaignName || 'AutoTest_{materialName}_{date}')
      .replace('{materialName}', material.name.split('.')[0])
      .replace('{date}', date)
    
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
    }
    
    logger.info(`[MaterialAutoTest] Creating test ad for material: ${material.name}`)
    
    // 使用批量广告服务创建
    // 注意：这里简化了，实际需要更完整的参数
    const result = await bulkAdService.createDraftAndTask({
      accounts: [{
        id: config.accountId,
        name: config.accountName || config.accountId,
        tokenId: token._id.toString(),
      }],
      copywritingPackageId: '', // 需要一个默认文案包
      targetingPackageId: config.targetingPackageId || '',
      settings: {
        dailyBudget: config.dailyBudget,
        bidStrategy: config.bidStrategy,
        optimizationGoal: config.optimizationGoal || 'APP_INSTALLS',
      },
      materials: [materialId],
      userId: config.createdBy,
    })
    
    // 更新统计
    await AutoTestConfig.findByIdAndUpdate(config._id, {
      $inc: { totalCreated: 1 },
      lastRunAt: new Date(),
    })
    
    return result
  }
  
  /**
   * 检查待测试的新素材
   * 每 10 分钟执行一次
   */
  async checkNewMaterials(): Promise<void> {
    const configs = await AutoTestConfig.find({ enabled: true })
    
    if (configs.length === 0) {
      return
    }
    
    logger.info(`[MaterialAutoTest] Checking new materials for ${configs.length} configs...`)
    
    for (const config of configs) {
      try {
        // 查找最近 10 分钟上传且未测试的素材
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
        
        const query: any = {
          status: 'uploaded',
          createdAt: { $gte: tenMinutesAgo },
          autoTestStatus: { $ne: 'tested' },  // 未测试过
        }
        
        // 应用筛选条件
        if (config.materialTypes && config.materialTypes.length > 0) {
          query.type = { $in: config.materialTypes }
        }
        if (config.folders && config.folders.length > 0) {
          query.folder = { $in: config.folders }
        }
        if (config.tags && config.tags.length > 0) {
          query.tags = { $in: config.tags }
        }
        
        const materials = await Material.find(query).limit(5)  // 每次最多 5 个
        
        for (const material of materials) {
          try {
            await this.createTestAd(material._id.toString(), config._id?.toString())
            
            // 标记为已测试
            await Material.findByIdAndUpdate(material._id, {
              autoTestStatus: 'tested',
              autoTestAt: new Date(),
            })
            
            logger.info(`[MaterialAutoTest] Created test ad for: ${material.name}`)
          } catch (error: any) {
            logger.error(`[MaterialAutoTest] Failed to create test ad for ${material.name}: ${error.message}`)
            
            // 标记为失败
            await Material.findByIdAndUpdate(material._id, {
              autoTestStatus: 'failed',
              autoTestError: error.message,
            })
          }
        }
      } catch (error: any) {
        logger.error(`[MaterialAutoTest] Config ${config.name} check failed: ${error.message}`)
      }
    }
  }
}

export const materialAutoTestService = new MaterialAutoTestService()
export default materialAutoTestService
