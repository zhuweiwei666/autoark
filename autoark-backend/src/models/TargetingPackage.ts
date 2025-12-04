import mongoose from 'mongoose'

/**
 * 定向包数据模型
 * 用于保存和复用 Facebook 广告受众定向配置
 */
const targetingPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    accountId: { type: String, index: true },  // 可选，定向包可跨账户使用
    platform: { type: String, default: 'facebook', enum: ['facebook', 'tiktok', 'google'] },
    
    // 地理位置定向
    geoLocations: {
      countries: [{ type: String }],  // 国家代码列表 ['US', 'CA']
      regions: [{
        key: String,
        name: String,
        country: String,
      }],
      cities: [{
        key: String,
        name: String,
        region: String,
        country: String,
        radius: Number,  // 半径（公里）
      }],
      locationTypes: [{ type: String }],  // ['home', 'recent']
    },
    
    // 人口统计定向
    demographics: {
      ageMin: { type: Number, default: 18 },
      ageMax: { type: Number, default: 65 },
      genders: [{ type: Number }],  // [1: 男, 2: 女]
    },
    
    // 兴趣标签定向
    interests: [{
      id: String,
      name: String,
      audienceSize: Number,
      path: [String],
    }],
    
    // 行为定向
    behaviors: [{
      id: String,
      name: String,
      audienceSize: Number,
    }],
    
    // 自定义受众
    customAudiences: [{
      id: String,
      name: String,
    }],
    
    // 排除设置
    exclusions: {
      interests: [{
        id: String,
        name: String,
      }],
      behaviors: [{
        id: String,
        name: String,
      }],
      customAudiences: [{ type: String }],
      locations: [{
        key: String,
        name: String,
        type: String,  // 'country', 'region', 'city'
      }],
    },
    
    // 扩展设置
    targetingOptimization: { 
      type: String, 
      default: 'none',
      enum: ['none', 'expansion_all'],
    },
    targetingRelaxationTypes: [{ type: String }],
    
    // 版位设置
    placement: {
      type: { type: String, default: 'automatic', enum: ['automatic', 'manual'] },
      // 手动版位时的详细配置
      platforms: [{
        type: String,
        enum: ['facebook', 'instagram', 'messenger', 'audience_network'],
      }],
      positions: [{
        type: String,
        // Facebook 版位
        // feed, right_hand_column, instant_article, marketplace, video_feeds, story, search, instream_video
        // Instagram 版位
        // stream, story, explore, reels
        // Messenger 版位
        // messenger_home, sponsored_messages, story
        // Audience Network 版位
        // classic, instream_video, rewarded_video
      }],
      devicePlatforms: [{
        type: String,
        enum: ['mobile', 'desktop'],
      }],
    },
    
    // 设备和操作系统设置
    deviceSettings: {
      // 移动操作系统
      mobileOS: [{
        type: String,
        enum: ['iOS', 'Android', 'all'],
      }],
      // 具体设备类型
      mobileDevices: [{
        type: String,
        enum: [
          'iphone_all', 'ipad_all', 'ipod_all',  // iOS 设备
          'android_smartphone', 'android_tablet',  // Android 设备
          'feature_phone',  // 功能机
        ],
      }],
      // iOS 最低版本
      iosVersionMin: { type: String },
      // iOS 最高版本
      iosVersionMax: { type: String },
      // Android 最低版本
      androidVersionMin: { type: String },
      // Android 最高版本
      androidVersionMax: { type: String },
      // 仅限 Wi-Fi
      wifiOnly: { type: Boolean, default: false },
      // 排除的设备
      excludedDevices: [{ type: String }],
    },
    
    // 优化目标
    optimizationGoal: {
      type: String,
      default: 'OFFSITE_CONVERSIONS',
      enum: ['OFFSITE_CONVERSIONS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH', 'LANDING_PAGE_VIEWS', 'APP_INSTALLS'],
    },
    
    // 预估受众规模
    estimatedAudienceSize: {
      lower: Number,
      upper: Number,
    },
    
    // 是否保存到 Facebook
    savedToFacebook: { type: Boolean, default: false },
    facebookSavedAudienceId: { type: String },
    
    // 元数据
    description: { type: String },
    tags: [{ type: String }],
    createdBy: { type: String },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
)

// 复合索引
targetingPackageSchema.index({ accountId: 1, name: 1 }, { unique: true })
targetingPackageSchema.index({ platform: 1, createdAt: -1 })

// 转换为 Facebook API 格式的方法
targetingPackageSchema.methods.toFacebookTargeting = function() {
  const targeting: any = {}
  
  // 地理位置
  if (this.geoLocations) {
    targeting.geo_locations = {}
    if (this.geoLocations.countries?.length) {
      targeting.geo_locations.countries = this.geoLocations.countries
    }
    if (this.geoLocations.regions?.length) {
      targeting.geo_locations.regions = this.geoLocations.regions.map((r: any) => ({ key: r.key }))
    }
    if (this.geoLocations.cities?.length) {
      targeting.geo_locations.cities = this.geoLocations.cities.map((c: any) => ({
        key: c.key,
        radius: c.radius,
        distance_unit: 'kilometer',
      }))
    }
    if (this.geoLocations.locationTypes?.length) {
      targeting.geo_locations.location_types = this.geoLocations.locationTypes
    }
  }
  
  // 人口统计
  if (this.demographics) {
    if (this.demographics.ageMin) targeting.age_min = this.demographics.ageMin
    if (this.demographics.ageMax) targeting.age_max = this.demographics.ageMax
    if (this.demographics.genders?.length) targeting.genders = this.demographics.genders
  }
  
  // 兴趣和行为 (flexible_spec)
  const flexibleSpec: any[] = []
  if (this.interests?.length || this.behaviors?.length) {
    const spec: any = {}
    if (this.interests?.length) {
      spec.interests = this.interests.map((i: any) => ({ id: i.id, name: i.name }))
    }
    if (this.behaviors?.length) {
      spec.behaviors = this.behaviors.map((b: any) => ({ id: b.id, name: b.name }))
    }
    flexibleSpec.push(spec)
  }
  if (flexibleSpec.length) {
    targeting.flexible_spec = flexibleSpec
  }
  
  // 自定义受众
  if (this.customAudiences?.length) {
    targeting.custom_audiences = this.customAudiences.map((ca: any) => ({ id: ca.id }))
  }
  
  // 排除
  if (this.exclusions) {
    const exclusions: any = {}
    if (this.exclusions.interests?.length) {
      exclusions.interests = this.exclusions.interests.map((i: any) => ({ id: i.id }))
    }
    if (this.exclusions.behaviors?.length) {
      exclusions.behaviors = this.exclusions.behaviors.map((b: any) => ({ id: b.id }))
    }
    if (this.exclusions.customAudiences?.length) {
      targeting.excluded_custom_audiences = this.exclusions.customAudiences.map((id: string) => ({ id }))
    }
    if (Object.keys(exclusions).length) {
      targeting.exclusions = exclusions
    }
  }
  
  // 受众扩展
  if (this.targetingOptimization && this.targetingOptimization !== 'none') {
    targeting.targeting_optimization = this.targetingOptimization
  }
  
  return targeting
}

export default mongoose.model('TargetingPackage', targetingPackageSchema)

