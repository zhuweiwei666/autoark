"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const accountGroupSchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50,
    },
    description: {
        type: String,
        trim: true,
        maxlength: 200,
    },
    color: {
        type: String,
        default: '#3B82F6', // 默认蓝色
    },
    organizationId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Organization',
        index: true,
        // 可选：未分配的账户分组不关联组织
    },
    accounts: [{
            type: String, // Facebook accountId
        }],
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
}, {
    timestamps: true,
});
// 索引
accountGroupSchema.index({ organizationId: 1 });
accountGroupSchema.index({ createdBy: 1 });
accountGroupSchema.index({ 'accounts': 1 });
exports.default = mongoose_1.default.model('AccountGroup', accountGroupSchema);
