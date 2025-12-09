"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
/**
 * 文案包数据模型
 * 用于保存和复用 Facebook 广告文案配置
 */
const copywritingPackageSchema = new mongoose_1.default.Schema({
    name: { type: String, required: true },
    organizationId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: 'Organization', index: true }, // 组织隔离
    accountId: { type: String, index: true }, // 可选，文案包可跨账户使用
    platform: { type: String, default: 'facebook', enum: ['facebook', 'tiktok', 'google'] },
    // 文案内容（支持多条，用于 A/B 测试或动态素材）
    content: {
        // 正文（最多5条）
        primaryTexts: [{ type: String }],
        // 标题（最多5条）
        headlines: [{ type: String }],
        // 描述（最多5条）
        descriptions: [{ type: String }],
    },
    // 行动号召按钮
    callToAction: {
        type: String,
        default: 'SHOP_NOW',
        enum: [
            'SHOP_NOW',
            'LEARN_MORE',
            'SIGN_UP',
            'DOWNLOAD',
            'GET_OFFER',
            'GET_QUOTE',
            'BOOK_NOW',
            'CONTACT_US',
            'SUBSCRIBE',
            'WATCH_MORE',
            'APPLY_NOW',
            'BUY_NOW',
            'ORDER_NOW',
            'SEE_MORE',
            'MESSAGE_PAGE',
            'WHATSAPP_MESSAGE',
            'CALL_NOW',
            'GET_DIRECTIONS',
            'NO_BUTTON',
        ],
    },
    // 链接配置
    links: {
        websiteUrl: { type: String },
        displayLink: { type: String }, // 显示的简短链接
        deepLink: { type: String }, // App 深度链接
    },
    // 产品信息（从 websiteUrl 自动解析）
    product: {
        name: { type: String }, // 产品名称（自动提取或手动设置）
        identifier: { type: String }, // 产品唯一标识
        domain: { type: String }, // 主域名
        autoExtracted: { type: Boolean, default: true }, // 是否自动提取
    },
    // URL 参数（用于追踪）
    urlParameters: {
        utmSource: { type: String },
        utmMedium: { type: String },
        utmCampaign: { type: String },
        utmContent: { type: String },
        customParams: { type: Map, of: String },
    },
    // 元数据
    description: { type: String },
    tags: [{ type: String }],
    language: { type: String, default: 'en' },
    createdBy: { type: String },
    // 统计
    usageCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date },
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// 复合索引
copywritingPackageSchema.index({ accountId: 1, name: 1 }, { unique: true });
copywritingPackageSchema.index({ platform: 1, createdAt: -1 });
copywritingPackageSchema.index({ tags: 1 });
// 转换为 Facebook API 格式的方法
copywritingPackageSchema.methods.toFacebookAdCreative = function (materialUrl, materialType) {
    const creative = {
        object_story_spec: {
            link_data: {
                link: this.links?.websiteUrl || '',
                call_to_action: {
                    type: this.callToAction,
                },
            },
        },
    };
    // 文案内容
    if (this.content.primaryTexts?.length) {
        creative.object_story_spec.link_data.message = this.content.primaryTexts[0];
    }
    if (this.content.headlines?.length) {
        creative.object_story_spec.link_data.name = this.content.headlines[0];
    }
    if (this.content.descriptions?.length) {
        creative.object_story_spec.link_data.description = this.content.descriptions[0];
    }
    // 显示链接
    if (this.links?.displayLink) {
        creative.object_story_spec.link_data.caption = this.links.displayLink;
    }
    // 素材
    if (materialUrl) {
        if (materialType === 'video') {
            creative.object_story_spec.link_data.video_data = {
                video_id: materialUrl, // 这里应该是 video_id
                call_to_action: {
                    type: this.callToAction,
                    value: { link: this.links?.websiteUrl || '' },
                },
            };
        }
        else {
            creative.object_story_spec.link_data.image_hash = materialUrl;
        }
    }
    // URL 参数
    if (this.urlParameters) {
        const params = [];
        if (this.urlParameters.utmSource)
            params.push(`utm_source=${this.urlParameters.utmSource}`);
        if (this.urlParameters.utmMedium)
            params.push(`utm_medium=${this.urlParameters.utmMedium}`);
        if (this.urlParameters.utmCampaign)
            params.push(`utm_campaign=${this.urlParameters.utmCampaign}`);
        if (this.urlParameters.utmContent)
            params.push(`utm_content=${this.urlParameters.utmContent}`);
        if (this.urlParameters.customParams) {
            this.urlParameters.customParams.forEach((value, key) => {
                params.push(`${key}=${value}`);
            });
        }
        if (params.length && creative.object_story_spec.link_data.link) {
            const separator = creative.object_story_spec.link_data.link.includes('?') ? '&' : '?';
            creative.object_story_spec.link_data.link += separator + params.join('&');
        }
    }
    return creative;
};
// 获取完整的落地页 URL（包含追踪参数）
copywritingPackageSchema.methods.getFullUrl = function () {
    let url = this.links?.websiteUrl || '';
    if (!url)
        return url;
    const params = [];
    if (this.urlParameters) {
        if (this.urlParameters.utmSource)
            params.push(`utm_source=${encodeURIComponent(this.urlParameters.utmSource)}`);
        if (this.urlParameters.utmMedium)
            params.push(`utm_medium=${encodeURIComponent(this.urlParameters.utmMedium)}`);
        if (this.urlParameters.utmCampaign)
            params.push(`utm_campaign=${encodeURIComponent(this.urlParameters.utmCampaign)}`);
        if (this.urlParameters.utmContent)
            params.push(`utm_content=${encodeURIComponent(this.urlParameters.utmContent)}`);
    }
    if (params.length) {
        const separator = url.includes('?') ? '&' : '?';
        url += separator + params.join('&');
    }
    return url;
};
exports.default = mongoose_1.default.model('CopywritingPackage', copywritingPackageSchema);
