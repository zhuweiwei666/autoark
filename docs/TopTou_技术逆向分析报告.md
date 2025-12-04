# TopTou 竞品技术逆向分析报告

> 分析日期：2025-12-04
> 分析版本：TopTou v1.0
> 目的：为 AutoArk 提供技术参考

---

## 一、技术栈分析

### 1.1 前端技术栈

| 技术 | TopTou | AutoArk（当前）| 建议 |
|------|--------|----------------|------|
| **框架** | Vue 3 | React 18 | 保持 React |
| **UI 组件库** | Element Plus | TailwindCSS | 可考虑 Ant Design |
| **构建工具** | Vite | Vite | ✅ 一致 |
| **状态管理** | Pinia (推测) | React Hooks | - |
| **工具库** | lodash, dayjs | 内置 | 可引入 dayjs |
| **图标** | iconfont | - | 可考虑 |

### 1.2 后端 API 结构

**API 前缀**: `/phoenix/v1.0/`

```
TopTou API 命名空间设计:
├── /phoenix/v1.0/          # 主业务 API
│   ├── /user/              # 用户相关
│   ├── /fb/                # Facebook 相关
│   ├── /ad/                # 广告相关
│   ├── /account/           # 账户相关
│   ├── /oauth/             # OAuth 相关
│   ├── /common/            # 公共接口
│   └── /permission/        # 权限相关
├── /phoenix/v1.1/          # 新版本 API
│   └── /project/           # 项目管理
└── /auth-user/             # 用户认证
    └── /bind/              # 绑定相关
```

### 1.3 监控系统

| 工具 | 用途 | 域名/标识 |
|------|------|-----------|
| **Sentry** | 错误监控 | `sentry.tec-do.cn` |
| **华为云 APM** | 性能监控 | `apm-web.cn-north-4.myhuaweicloud.com` |
| **Google Analytics** | 用户分析 | `G-KPM7CDHBEJ` |
| **阿里云日志** | 日志收集 | `pho-hwgz-prod.log-global.aliyuncs.com` |
| **自建埋点** | 行为追踪 | `eagle-track-report.tec-do.cn` |

---

## 二、Facebook OAuth 授权流程

### 2.1 OAuth 配置

```javascript
// TopTou Facebook OAuth 配置
const FACEBOOK_OAUTH_CONFIG = {
  app_id: '1105164709851851',
  api_version: 'v22.0',
  redirect_uri: 'https://toptou.tec-do.com/assets/account/auth-result',
  
  // 请求的权限列表（共13项）
  scope: [
    'public_profile',           // 基础用户信息
    'ads_management',           // 广告管理（核心）
    'ads_read',                 // 广告读取（核心）
    'read_insights',            // 数据洞察（核心）
    'pages_show_list',          // 主页列表
    'pages_read_engagement',    // 主页互动数据
    'business_management',      // 商务管理中心
    'business_creative_management',  // 创意管理
    'business_creative_insights',    // 创意洞察
    'pages_read_user_content',  // 主页用户内容
    'pages_manage_engagement',  // 主页互动管理
    'pages_manage_metadata',    // 主页元数据
    'catalog_management'        // 商品目录管理
  ]
};
```

### 2.2 OAuth 流程图

```
┌──────────────────────────────────────────────────────────────┐
│                    TopTou OAuth 授权流程                      │
└──────────────────────────────────────────────────────────────┘

1. 用户点击"新增授权"
       │
       ▼
┌──────────────────┐
│   TopTou 前端    │
│  跳转 Facebook   │
└────────┬─────────┘
         │
         │ GET https://www.facebook.com/v22.0/dialog/oauth
         │   ?client_id=1105164709851851
         │   &redirect_uri=https://toptou.tec-do.com/assets/account/auth-result
         │   &scope=public_profile,ads_management,ads_read,...
         │   &state=Facebook
         │
         ▼
┌──────────────────┐
│ Facebook 登录页  │
│ 用户输入凭据     │
└────────┬─────────┘
         │
         │ 用户授权后重定向
         │
         ▼
┌──────────────────┐
│   TopTou 前端    │
│  /auth-result    │
│  ?code=xxx       │
│  &state=Facebook │
└────────┬─────────┘
         │
         │ GET /phoenix/v1.0/fb/access-token?code=xxx
         │
         ▼
┌──────────────────┐
│   TopTou 后端    │
│  换取 Token      │
└────────┬─────────┘
         │
         │ POST https://graph.facebook.com/v22.0/oauth/access_token
         │   ?client_id=APP_ID
         │   &client_secret=APP_SECRET
         │   &redirect_uri=REDIRECT_URI
         │   &code=xxx
         │
         ▼
┌──────────────────┐
│   Facebook API   │
│  返回 Token      │
└────────┬─────────┘
         │
         │ { access_token, token_type, expires_in }
         │
         ▼
┌──────────────────┐
│   TopTou 后端    │
│  存储 Token      │
│  同步广告账户    │
└──────────────────┘
```

### 2.3 Token 交换 API

```
GET /phoenix/v1.0/fb/access-token?code={authorization_code}

Response:
{
  "code": 0,
  "message": "success",
  "data": {
    "access_token": "EAAxxxxxxxx",
    "token_type": "bearer",
    "expires_in": 5183999
  }
}
```

---

## 三、账户管理 API

### 3.1 API 列表

| API | 方法 | 用途 | 参数 |
|-----|------|------|------|
| `/phoenix/v1.0/oauth/platform/list` | GET | 获取支持的 OAuth 平台列表 | - |
| `/phoenix/v1.0/ad/account/all/media-status/list` | GET | 获取媒体账户状态 | `platform=Facebook` |
| `/phoenix/v1.0/account/ad/all/media/query` | POST | 查询所有媒体账户 | body |
| `/phoenix/v1.0/account/ad/account/query` | POST | 查询广告账户详情 | body |
| `/phoenix/v1.0/common/role/user/list` | GET | 获取角色用户列表 | `role=optimizer` |
| `/phoenix/v1.0/permission/user/list` | POST | 获取用户权限列表 | body |
| `/phoenix/v1.1/project/list` | POST | 获取项目列表 | body |

### 3.2 账户数据模型

```javascript
// 广告账户数据模型（从表格字段推断）
const AdAccountModel = {
  // 基础信息
  account_name: String,        // 广告账户名称
  account_id: String,          // 账户 ID
  media_account_id: String,    // 所属媒体账号
  
  // 归属关系
  owner_user_id: String,       // 所属用户
  optimizer_id: String,        // 所属优化师
  company_id: String,          // 公司
  project_id: String,          // 当前所属项目
  
  // 状态信息
  status: String,              // 账户状态 (ACTIVE, DISABLED, etc.)
  balance: Number,             // 账户余额
  sync_start_date: Date,       // 资产同步起始日期
  
  // 权限信息
  data_permission: Array,      // 数据权限
  ad_permission: Array,        // 广告权限
  
  // 其他
  remark: String,              // 备注
  created_at: Date,
  updated_at: Date
};
```

---

## 四、功能模块分析

### 4.1 完整功能架构

```
TopTou 功能模块
├── 📊 广告投放
│   ├── Meta (Facebook/Instagram)
│   ├── TikTok
│   └── Google
│
├── 📈 数据分析
│   ├── 广告报表
│   ├── 素材报表
│   └── 自定义报表
│
├── 💼 资产管理
│   ├── 账户管理 (支持7个平台: Meta/TikTok/Google/Huawei/Kwai/Snapchat/Apple)
│   ├── TopTou素材库
│   ├── Facebook主页
│   ├── Pixel像素
│   ├── 定向包
│   ├── 文案包
│   ├── 创意组
│   ├── 产品管理
│   └── 项目管理
│
├── 🛠 服务工具
│   ├── 任务管理
│   │   ├── 投放任务
│   │   ├── 同步媒体任务
│   │   ├── 下载素材
│   │   ├── 自动任务
│   │   └── RSOC任务
│   ├── 广告模板
│   ├── AI托管
│   ├── AI应用监控
│   ├── 第三方监测
│   ├── 水印工具
│   └── 素材标签
│
└── ⚙️ 管理配置
    ├── 人员管理
    ├── 部门管理
    ├── 权限管理
    └── 授权管理
```

### 4.2 与 AutoArk 功能对比

| 功能 | TopTou | AutoArk | 优先级 |
|------|--------|---------|--------|
| Facebook 数据同步 | ✅ | ✅ | - |
| TikTok 数据同步 | ✅ | ❌ | 高 |
| Google 数据同步 | ✅ | ❌ | 高 |
| 多账户管理 | ✅ (7平台) | ✅ (1平台) | 高 |
| 定向包管理 | ✅ | ❌ | 中 |
| 文案包管理 | ✅ | ❌ | 中 |
| 创意组管理 | ✅ | ❌ | 中 |
| 批量广告投放 | ✅ | ❌ | 高 |
| 广告模板 | ✅ | ❌ | 中 |
| AI 托管 | ✅ | 🚧 规划中 | 高 |
| 素材库 | ✅ | ❌ | 中 |
| 权限管理 | ✅ | ❌ | 中 |

---

## 五、技术实现建议

### 5.1 短期优化（1-2周）

#### 5.1.1 增强 OAuth 权限

```javascript
// 建议 AutoArk 增加的权限
const ADDITIONAL_SCOPES = [
  'business_management',           // 商务管理中心
  'business_creative_management',  // 创意管理
  'catalog_management',            // 电商产品目录
];
```

#### 5.1.2 账户管理字段扩展

```javascript
// 建议增加的字段
const ACCOUNT_EXTENSIONS = {
  optimizer_id: String,      // 所属优化师
  project_id: String,        // 所属项目
  balance: Number,           // 账户余额
  data_permission: Array,    // 数据权限
  ad_permission: Array,      // 广告权限
};
```

### 5.2 中期功能（1-2月）

#### 5.2.1 定向包数据结构（推测）

```javascript
// 定向包数据模型
const TargetingPackage = {
  id: String,
  name: String,
  platform: 'Facebook' | 'TikTok' | 'Google',
  
  // 地理位置
  geo_locations: {
    countries: Array<String>,
    regions: Array<String>,
    cities: Array<String>,
  },
  
  // 人口统计
  demographics: {
    age_min: Number,
    age_max: Number,
    genders: Array<'male' | 'female' | 'unknown'>,
  },
  
  // 兴趣定向
  interests: Array<{
    id: String,
    name: String,
  }>,
  
  // 行为定向
  behaviors: Array<{
    id: String,
    name: String,
  }>,
  
  // 自定义受众
  custom_audiences: Array<String>,
  
  // 排除设置
  exclusions: {
    custom_audiences: Array<String>,
    locations: Array<String>,
  },
  
  created_at: Date,
  updated_at: Date,
};
```

#### 5.2.2 文案包数据结构（推测）

```javascript
// 文案包数据模型
const CopyPackage = {
  id: String,
  name: String,
  
  // 文案内容
  copies: Array<{
    primary_text: String,     // 主文案
    headline: String,         // 标题
    description: String,      // 描述
    call_to_action: String,   // 行动号召
    language: String,         // 语言
  }>,
  
  // 标签
  tags: Array<String>,
  
  created_at: Date,
  updated_at: Date,
};
```

### 5.3 长期规划（3-6月）

#### 5.3.1 推荐架构

```
┌─────────────────────────────────────────┐
│           Frontend (React/Vue)          │
│   - Element Plus / Ant Design           │
│   - Vite + TypeScript                   │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│           API Gateway (Nginx)           │
│   - 路由分发                            │
│   - 限流熔断                            │
│   - SSL 终结                            │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│        Backend Services (Node/Go)       │
│   - 用户服务                            │
│   - 广告服务 (Meta/TikTok/Google)       │
│   - 任务服务                            │
│   - AI 服务                             │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│            Data Layer                   │
│   - MongoDB (主数据)                    │
│   - Redis (缓存/队列)                   │
│   - ClickHouse (分析) - 可选            │
└─────────────────────────────────────────┘
```

---

## 六、定向包管理 API

### 6.1 定向包 API 列表

| API | 方法 | 用途 |
|-----|------|------|
| `/phoenix/v1.0/targetPackage/list` | POST | 获取定向包列表 |
| `/phoenix/v1.0/targetPackage/checkTargetingName` | POST | 校验定向包名称 |
| `/phoenix/v1.0/targetPackage/saveToFaceBook` | POST | 保存定向包到Facebook |
| `/phoenix/v1.0/fbApplication/targetingSearch` | POST | 兴趣标签搜索 |
| `/phoenix/v1.0/fbApplication/searchAdGeolocation` | POST | 地理位置搜索 |
| `/phoenix/v1.0/directional/ad/account/query` | POST | 查询可用广告账户 |

### 6.2 定向包完整数据结构

```typescript
// POST /phoenix/v1.0/targetPackage/saveToFaceBook
interface TargetingPackageRequest {
  name: string;                           // 定向包名称
  adAccountId: string;                    // 广告账户ID
  platform: 'Facebook' | 'TikTok' | 'Google';
  
  // 地理位置定向
  geo_locations: {
    countries: string[];                  // 国家代码
    regions: Array<{
      key: string;
      name: string;
    }>;
    cities: Array<{
      key: string;
      name: string;
      radius?: number;
    }>;
    location_types: string[];             // ['home', 'recent']
  };
  
  // 人口统计定向
  age_min: number;                        // 最小年龄
  age_max: number;                        // 最大年龄
  genders: number[];                      // [1: 男, 2: 女]
  
  // 兴趣标签定向
  flexible_spec: Array<{
    interests: Array<{
      id: string;
      name: string;
    }>;
    behaviors: Array<{
      id: string;
      name: string;
    }>;
  }>;
  
  // 排除定向
  exclusions: {
    interests: Array<{id: string; name: string}>;
    behaviors: Array<{id: string; name: string}>;
    custom_audiences: string[];
  };
  
  // 扩展设置
  targeting_optimization: string;          // 'none' | 'expansion_all'
  targeting_relaxation_types?: string[];   // 受众扩展类型
}
```

---

## 七、文案包管理 API

### 7.1 文案包 API 列表

| API | 方法 | 用途 |
|-----|------|------|
| `/phoenix/v1.0/tmTextLibrary/list` | POST | 获取文案包列表 |
| `/phoenix/v1.0/tmTextLibrary/save` | POST | 保存文案包 |
| `/phoenix/v1.0/tmTextLibrary/delete` | DELETE | 删除文案包 |

### 7.2 文案包完整数据结构

```typescript
// POST /phoenix/v1.0/tmTextLibrary/save
interface CopywritingPackageRequest {
  platform: 'Facebook' | 'TikTok' | 'Google';
  name: string;                           // 文案包名称
  
  // Facebook 文案字段（支持多条）
  primaryText: string[];                  // 正文列表
  headline: string[];                     // 标题列表
  description: string[];                  // 描述列表
  callToAction: string;                   // 行动号召按钮
  
  // 链接配置
  websiteUrl: string;                     // 落地页URL
  displayLink?: string;                   // 显示链接
}

// POST /phoenix/v1.0/tmTextLibrary/list Response
interface CopywritingPackageListResponse {
  code: number;
  data: {
    list: CopywritingPackage[];
    total: number;
  };
}
```

---

## 八、创意素材管理 API

### 8.1 素材 API 列表

| API | 方法 | 用途 |
|-----|------|------|
| `/phoenix/v1.0/creativeGroup/list` | POST | 获取创意组列表 |
| `/phoenix/v1.0/creative/material/create` | POST | 创建素材记录 |
| `/phoenix/v1.0/creative/material/page` | POST | 分页查询素材 |
| `/phoenix/v1.0/creative/material/folder/tree` | GET | 获取文件夹树 |
| `/phoenix/v1.0/creative/material/platform/sync` | POST | 从Facebook同步素材 |
| `/phoenix/v1.1/sts/get-ram-role` | GET | 获取OSS临时凭证 |

### 8.2 素材上传流程

```
┌─────────────────────────────────────────────────────────────┐
│                    素材上传完整流程                          │
└─────────────────────────────────────────────────────────────┘

1. 获取 OSS 临时凭证
   GET /phoenix/v1.1/sts/get-ram-role
   │
   └─→ { AccessKeyId, AccessKeySecret, SecurityToken, Expiration }

2. 初始化分片上传
   POST https://oss-toptou.tec-do.com/{objectKey}?uploads
   │
   └─→ { UploadId }

3. 上传分片 (每片5MB)
   PUT https://oss-toptou.tec-do.com/{objectKey}?partNumber=N&uploadId=xxx
   │
   └─→ 循环上传所有分片

4. 完成分片上传
   POST https://oss-toptou.tec-do.com/{objectKey}?uploadId=xxx
   │
   └─→ { ETag, Location }

5. 创建素材记录
   POST /phoenix/v1.0/creative/material/create
   {
     name: "文件名",
     url: "OSS URL",
     type: "video" | "image",
     width: number,
     height: number,
     duration?: number,
     size: number,
     folderId: string
   }
```

### 8.3 从 Facebook 同步素材

```typescript
// POST /phoenix/v1.0/creative/material/platform/sync
interface SyncFromFacebookRequest {
  accountId: string;                      // Facebook广告账户ID
  materials: Array<{
    adImageHash?: string;                 // 图片Hash
    videoId?: string;                     // 视频ID
    thumbnailUrl?: string;                // 缩略图URL
    name: string;
    type: 'image' | 'video';
  }>;
  folderId: string;                       // 目标文件夹
}
```

---

## 九、批量发布广告 API（核心）

### 9.1 广告创建五步流程

```
┌─────────────────────────────────────────────────────────────┐
│                TopTou 批量广告创建流程                       │
└─────────────────────────────────────────────────────────────┘

步骤 1：选择投放账户
├── 推广目标：竞拍/预定、销量/应用安装
├── 转化发生位置：网站/应用
├── 资产配置：全局配置/单个配置
├── 媒体账号：选择Facebook个人号
├── 投放账号：添加广告账户(最多20个)
├── FB主页：选择绑定的主页
├── Instagram账户：选择关联的IG账户
├── 像素代码：选择Pixel
├── 网域：选择已验证域名
└── 转化事件：Purchase/AddToCart等

步骤 2：配置广告系列
├── 广告系列名称：支持命名规则
├── 广告系列状态：开启/关闭
├── 广告系列消耗限制
├── 赋能型广告预算优化（CBO）
├── 广告系列预算：日预算/总预算
├── 广告竞价策略
└── 使用目录

步骤 3：配置广告组
├── 广告组名称：支持命名规则
├── 广告组状态
├── 动态素材开关
├── 时区设置
├── 投放日期：开始/结束
├── 广告组花费限额
├── 广告投放优化目标
├── 单次成效费用目标
├── 归因设置
├── 投放速度
├── 定向包选择（复用已有定向包）
├── 竞价系数
├── 版位：进阶赋能型/手动版位
├── 设备类型：全部/Android/iOS
├── 包含/排除设备
├── 操作系统版本
├── WiFi限制
└── 平台选择：Facebook/Instagram/Audience Network/Messenger

步骤 4：配置广告创意
├── 广告名称：支持命名规则
├── 广告状态
├── 追踪设置：网站事件/应用事件
├── 广告设置：创建广告/使用现有帖子
├── 创意来源：手动上传/目录
├── 广告格式：单图或视频/轮播
├── 自动挑选素材
├── 创意组选择（复用已有创意组）
├── 批量添加创意组
└── 应用文案包（复用已有文案包）

步骤 5：预览发布
├── 批量投放策略
│   ├── 定向：按广告系列/按广告组
│   ├── 创意组：按账户/按广告系列/按广告组
│   └── 文案包：创意组共用/按顺序分配
├── 发布计划：立即发布/定时发布
├── 广告预览（按账户展开）
├── 存为广告模板
└── 发布广告
```

### 9.2 批量发布核心 API

| API | 方法 | 用途 |
|-----|------|------|
| `/phoenix/v1.0/fb/fbAdCreate/get/delimiter` | GET | 获取命名分隔符配置 |
| `/phoenix/v1.0/fb/fbAdCreate/save` | POST | 保存广告配置（草稿） |
| `/phoenix/v1.0/fb/fbAdCreate/publish` | POST | **发布广告到Facebook** |
| `/phoenix/v1.0/tm/task/get-task-list` | POST | 查询发布任务列表 |
| `/phoenix/v1.1/asset/check` | POST | 检查资产配置有效性 |

### 9.3 保存广告配置请求结构

```typescript
// POST /phoenix/v1.0/fb/fbAdCreate/save
interface AdCreateSaveRequest {
  // 步骤1：账户配置
  buyingType: 'AUCTION' | 'RESERVED';          // 竞拍/预定
  objectiveType: 'OUTCOME_SALES' | 'OUTCOME_APP_PROMOTION';  // 推广类型
  conversionLocation: 'WEBSITE' | 'APP';       // 转化位置
  assetConfigMode: 'GLOBAL' | 'INDIVIDUAL';    // 资产配置模式
  
  accounts: Array<{
    accountId: string;                         // 广告账户ID
    accountName: string;
    pageId: string;                            // Facebook主页
    instagramAccountId?: string;               // Instagram账户
    pixelId: string;                           // 像素ID
    domain?: string;                           // 网域
    conversionEvent: string;                   // 转化事件
  }>;
  
  // 步骤2：广告系列配置
  campaign: {
    name: string;                              // 系列名称规则
    status: 'ACTIVE' | 'PAUSED';
    spendCap?: number;                         // 消耗限制
    budgetOptimization: boolean;               // CBO开关
    budgetType: 'DAILY' | 'LIFETIME';          // 预算类型
    budget: number;                            // 预算金额
    bidStrategy: string;                       // 竞价策略
    useCatalog: boolean;
  };
  
  // 步骤3：广告组配置
  adset: {
    name: string;                              // 广告组名称规则
    status: 'ACTIVE' | 'PAUSED';
    dynamicCreative: boolean;                  // 动态素材
    timezone: string;                          // 时区
    startTime: string;                         // 开始时间
    endTime?: string;                          // 结束时间
    spendCap?: number;                         // 花费限额
    optimizationGoal: string;                  // 优化目标
    costCap?: number;                          // 费用上限
    attributionSpec: object;                   // 归因设置
    pacingType: 'standard' | 'no_pacing';      // 投放速度
    
    // 定向配置（可引用定向包）
    targeting: object | { targetingPackageId: string };
    
    // 版位配置
    placement: {
      type: 'AUTOMATIC' | 'MANUAL';
      platforms?: string[];
      positions?: string[];
    };
    
    // 设备配置
    device: {
      deviceType: 'ALL' | 'Android' | 'iOS';
      includedDevices?: string[];
      excludedDevices?: string[];
      osVersionMin?: string;
      osVersionMax?: string;
      wifiOnly: boolean;
    };
  };
  
  // 步骤4：广告创意配置
  ads: Array<{
    name: string;                              // 广告名称规则
    status: 'ACTIVE' | 'PAUSED';
    
    // 追踪配置
    tracking: {
      websiteEvent: boolean;
      appEvent: boolean;
      pixels?: string[];
      appIds?: string[];
    };
    
    // 创意配置
    creative: {
      type: 'CREATE' | 'EXISTING_POST';
      source: 'MANUAL' | 'CATALOG';
      format: 'SINGLE' | 'CAROUSEL';
      autoPickMaterial: boolean;
      
      // 创意组引用
      creativeGroupId?: string;
      
      // 或直接配置素材
      materials?: Array<{
        type: 'image' | 'video';
        url: string;
        thumbnail?: string;
      }>;
      
      // 文案包引用
      copywritingPackageId?: string;
      
      // 或直接配置文案
      copy?: {
        primaryText: string[];
        headline: string[];
        description: string[];
        callToAction: string;
        websiteUrl: string;
      };
    };
  }>;
  
  // 步骤5：发布策略
  publishStrategy: {
    targetingLevel: 'CAMPAIGN' | 'ADSET';       // 定向级别
    creativeLevel: 'ACCOUNT' | 'CAMPAIGN' | 'ADSET';  // 创意组级别
    copywritingMode: 'SHARED' | 'SEQUENTIAL';   // 文案分配
    schedule: 'IMMEDIATE' | 'SCHEDULED';        // 发布计划
    scheduledTime?: string;                     // 定时发布时间
  };
}
```

### 9.4 发布广告请求结构

```typescript
// POST /phoenix/v1.0/fb/fbAdCreate/publish
interface AdPublishRequest {
  draftId: string;                             // 草稿ID（save返回）
  publishNow: boolean;                         // 是否立即发布
  scheduledTime?: string;                      // 定时发布时间
}

// 响应
interface AdPublishResponse {
  code: number;
  message: string;
  data: {
    taskId: string;                            // 任务ID
    estimatedCampaigns: number;                // 预计创建的系列数
    estimatedAdsets: number;                   // 预计创建的广告组数
    estimatedAds: number;                      // 预计创建的广告数
  };
}
```

### 9.5 任务状态查询

```typescript
// POST /phoenix/v1.0/tm/task/get-task-list
interface TaskListRequest {
  taskType?: string;                           // 任务类型
  status?: string;                             // 任务状态
  platform?: string;                           // 平台
  accountIds?: string[];                       // 账户筛选
  dateRange?: [string, string];                // 日期范围
  page: number;
  pageSize: number;
}

interface TaskListResponse {
  code: number;
  data: {
    list: Array<{
      taskId: string;
      taskType: 'AD_CREATE' | 'AD_SYNC' | 'MATERIAL_DOWNLOAD';
      platform: string;
      accounts: Array<{
        accountId: string;
        accountName: string;
      }>;
      status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
      progress: number;                        // 进度百分比
      result?: {
        successCount: number;
        failedCount: number;
        errors?: Array<{
          entityId: string;
          errorCode: string;
          errorMessage: string;
        }>;
      };
      createdAt: string;
      updatedAt: string;
    }>;
    total: number;
  };
}
```

### 9.6 发布流程时序图

```
┌────────┐      ┌────────┐      ┌────────┐      ┌────────┐
│ 前端   │      │ 后端   │      │ 队列   │      │Facebook│
└───┬────┘      └───┬────┘      └───┬────┘      └───┬────┘
    │               │               │               │
    │ 1.保存草稿    │               │               │
    │──────────────>│               │               │
    │  /save        │               │               │
    │<──────────────│               │               │
    │  {draftId}    │               │               │
    │               │               │               │
    │ 2.点击发布    │               │               │
    │──────────────>│               │               │
    │  /publish     │ 3.创建任务   │               │
    │               │──────────────>│               │
    │<──────────────│               │               │
    │  {taskId}     │               │               │
    │               │               │               │
    │ 4.跳转任务页  │               │ 5.后台处理   │
    │──────────────>│               │               │
    │               │               │──────────────>│
    │               │               │ 创建Campaign │
    │               │               │<──────────────│
    │               │               │──────────────>│
    │               │               │ 创建AdSet    │
    │               │               │<──────────────│
    │               │               │──────────────>│
    │               │               │ 创建Ad       │
    │               │               │<──────────────│
    │               │               │               │
    │ 6.轮询状态    │               │               │
    │──────────────>│               │               │
    │/get-task-list │<──────────────│               │
    │<──────────────│               │               │
    │ {status,      │               │               │
    │  progress}    │               │               │
```

---

## 十、已验证的 API 清单

### 10.1 认证类 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/user/login` | POST | 200 |
| `/phoenix/v1.0/baseinfo/get` | GET | 200 |
| `/auth-user/bind/query` | GET | 200 |
| `/phoenix/v1.0/fb/access-token` | GET | 200 |

### 10.2 账户类 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/oauth/platform/list` | GET | 200 |
| `/phoenix/v1.0/ad/account/all/media-status/list` | GET | 200 |
| `/phoenix/v1.0/account/ad/all/media/query` | POST | 200 |
| `/phoenix/v1.0/account/ad/account/query` | POST | 200 |
| `/phoenix/v1.0/common/role/user/list` | GET | 200 |
| `/phoenix/v1.0/permission/user/list` | POST | 200 |
| `/phoenix/v1.1/project/list` | POST | 200 |
| `/phoenix/v1.0/media/accounts-choose-page` | GET | 200 |
| `/phoenix/v1.0/media/choose-accounts` | POST | 200 |

### 10.3 资产类 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/assets/pixel/list` | POST | 200 |
| `/phoenix/v1.0/fbApplication/getAdspixelId` | GET | 200 |
| `/phoenix/v1.0/account/customConversions` | GET | 200 |
| `/phoenix/v1.1/fb/tool/page/list` | POST | 200 |
| `/phoenix/v1.1/fb/tool/page/instagram/get` | GET | 200 |
| `/phoenix/v1.1/asset/check` | POST | 200 |

### 10.4 定向包 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/targetPackage/list` | POST | 200 |
| `/phoenix/v1.0/targetPackage/checkTargetingName` | POST | 200 |
| `/phoenix/v1.0/targetPackage/saveToFaceBook` | POST | 200 |
| `/phoenix/v1.0/fbApplication/targetingSearch` | POST | 200 |
| `/phoenix/v1.0/fbApplication/searchAdGeolocation` | POST | 200 |

### 10.5 文案包 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/tmTextLibrary/list` | POST | 200 |
| `/phoenix/v1.0/tmTextLibrary/save` | POST | 200 |

### 10.6 创意组 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/creativeGroup/list` | POST | 200 |
| `/phoenix/v1.0/creative/material/create` | POST | 200 |
| `/phoenix/v1.0/creative/material/page` | POST | 200 |
| `/phoenix/v1.0/creative/material/folder/tree` | GET | 200 |
| `/phoenix/v1.0/creative/material/platform/sync` | POST | 200 |
| `/phoenix/v1.1/sts/get-ram-role` | GET | 200 |

### 10.7 广告创建 API（核心）

| API | 方法 | 状态码 | 说明 |
|-----|------|--------|------|
| `/phoenix/v1.0/fb/fbAdCreate/get/delimiter` | GET | 200 | 获取命名分隔符 |
| `/phoenix/v1.0/fb/fbAdCreate/save` | POST | 200 | 保存广告草稿 |
| `/phoenix/v1.0/fb/fbAdCreate/publish` | POST | 200 | **发布广告** |
| `/phoenix/v1.0/cloak/websites/list` | GET | 200 | 获取Cloak网站 |

### 10.8 任务管理 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/tm/task/get-task-list` | POST | 200 |

### 10.9 公共类 API

| API | 方法 | 状态码 |
|-----|------|--------|
| `/phoenix/v1.0/country/list` | POST | 200 |
| `/phoenix/v1.0/kwai/oauth/type` | GET | 200 |

---

## 十一、总结

### 11.1 TopTou 技术优势

1. **多平台支持**: 支持 7 个广告平台统一管理
2. **完善的资产管理**: 定向包、文案包、创意组可复用
3. **批量操作能力**: 批量投放、批量编辑、跨账户操作
4. **AI 功能**: AI 托管、AI 监控
5. **完整的监控体系**: Sentry + APM + GA
6. **任务队列**: 异步发布，进度可追踪

### 11.2 批量发布核心技术点

```
TopTou 批量发布技术架构：

┌─────────────────────────────────────────────────────────┐
│                    批量发布关键设计                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. 模块化设计                                           │
│    ├── 定向包：复用受众定向配置                         │
│    ├── 文案包：复用广告文案内容                         │
│    └── 创意组：复用素材组合                             │
│                                                         │
│ 2. 笛卡尔积生成                                         │
│    └── N账户 × M定向 × K创意 = N×M×K 个广告             │
│                                                         │
│ 3. 草稿-发布模式                                        │
│    ├── save: 保存配置为草稿（可编辑）                   │
│    └── publish: 提交到任务队列执行                      │
│                                                         │
│ 4. 异步任务处理                                         │
│    ├── 后端队列逐个创建 Campaign/AdSet/Ad               │
│    ├── 进度实时更新                                     │
│    └── 错误单独记录，不影响其他广告                     │
│                                                         │
│ 5. 命名规则引擎                                         │
│    └── 支持变量：{账户名}_{定向名}_{创意组名}_{序号}    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 11.3 AutoArk 实现建议

#### 近期（1-2周）

```typescript
// 1. 定向包数据模型
interface TargetingPackage {
  _id: ObjectId;
  name: string;
  accountId: string;
  platform: 'Facebook';
  
  targeting: {
    geoLocations: object;
    demographics: object;
    interests: object[];
    behaviors: object[];
    customAudiences: string[];
  };
  
  createdAt: Date;
  updatedAt: Date;
}

// 2. 文案包数据模型
interface CopywritingPackage {
  _id: ObjectId;
  name: string;
  platform: 'Facebook';
  
  content: {
    primaryTexts: string[];
    headlines: string[];
    descriptions: string[];
  };
  
  callToAction: string;
  websiteUrl: string;
  
  createdAt: Date;
  updatedAt: Date;
}

// 3. 创意组数据模型
interface CreativeGroup {
  _id: ObjectId;
  name: string;
  
  materials: Array<{
    type: 'image' | 'video';
    url: string;
    thumbnail?: string;
    width: number;
    height: number;
  }>;
  
  createdAt: Date;
  updatedAt: Date;
}
```

#### 中期（1-2月）

```typescript
// 批量发布 API 设计
// POST /api/facebook/ads/bulk-create
interface BulkAdCreateRequest {
  accounts: string[];              // 广告账户ID列表
  targetingPackageId: string;      // 定向包ID
  copywritingPackageId: string;    // 文案包ID
  creativeGroupIds: string[];      // 创意组ID列表
  
  campaign: {
    nameTemplate: string;          // 命名规则
    budget: number;
    budgetType: 'daily' | 'lifetime';
    bidStrategy: string;
  };
  
  adset: {
    nameTemplate: string;
    optimizationGoal: string;
    startTime: string;
    endTime?: string;
  };
  
  ad: {
    nameTemplate: string;
  };
  
  publishStrategy: {
    mode: 'immediate' | 'scheduled';
    scheduledTime?: string;
  };
}

// 任务处理流程
async function processBulkAdCreate(request: BulkAdCreateRequest) {
  const taskId = generateTaskId();
  
  // 1. 创建任务记录
  await TaskQueue.create({
    taskId,
    type: 'BULK_AD_CREATE',
    status: 'pending',
    totalItems: calculateTotalAds(request),
    completedItems: 0,
  });
  
  // 2. 加入队列处理
  await BullMQ.add('bulk-ad-create', {
    taskId,
    request,
  });
  
  return { taskId };
}

// Worker 处理逻辑
async function bulkAdCreateWorker(job) {
  const { taskId, request } = job.data;
  
  for (const accountId of request.accounts) {
    try {
      // 3.1 创建 Campaign
      const campaign = await FacebookAPI.createCampaign(accountId, {...});
      
      // 3.2 创建 AdSet
      const adset = await FacebookAPI.createAdSet(accountId, campaign.id, {...});
      
      // 3.3 创建 Ads
      for (const creativeGroupId of request.creativeGroupIds) {
        const ad = await FacebookAPI.createAd(accountId, adset.id, {...});
        await updateTaskProgress(taskId);
      }
    } catch (error) {
      await recordTaskError(taskId, accountId, error);
    }
  }
  
  await completeTask(taskId);
}
```

#### 长期（3-6月）

1. **广告模板系统**: 保存常用配置为模板
2. **智能命名规则**: 支持变量替换和自动编号
3. **批量编辑功能**: 修改已发布广告的预算/状态
4. **AI 智能推荐**: 基于历史数据推荐定向/出价

### 11.4 关键技术参考

- **OAuth 权限**: 共 13 项权限，确保 `ads_management` 和 `business_management`
- **API 前缀**: `/phoenix/v1.0/` 用于核心功能，`/phoenix/v1.1/` 用于新功能
- **草稿-发布模式**: 先 save 保存配置，再 publish 提交执行
- **任务队列**: 使用 BullMQ 处理异步任务，支持进度追踪和错误恢复
- **OSS 上传**: 阿里云 OSS + STS 临时凭证 + 分片上传

### 11.5 发布流程最佳实践

```
推荐的 AutoArk 批量发布实现：

1. 前端配置阶段
   ├── 选择账户（支持多选）
   ├── 选择/创建定向包
   ├── 选择/创建文案包
   ├── 选择/创建创意组
   └── 配置命名规则和预算

2. 草稿保存
   ├── 前端组装完整配置
   └── POST /api/ads/draft -> { draftId }

3. 预览确认
   ├── 显示将创建的广告数量
   ├── 显示预估消耗
   └── 允许编辑修改

4. 提交发布
   ├── POST /api/ads/publish -> { taskId }
   └── 跳转到任务管理页面

5. 任务跟踪
   ├── WebSocket/轮询获取进度
   ├── 显示成功/失败数量
   └── 失败项支持重试
```

---

*本文档基于 2025-12-04 浏览器逆向工程分析，包含 TopTou 批量广告发布的完整技术实现，仅供技术参考，请遵守相关法律法规。*

