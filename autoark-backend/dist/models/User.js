"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserStatus = exports.UserRole = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
var UserRole;
(function (UserRole) {
    UserRole["SUPER_ADMIN"] = "super_admin";
    UserRole["ORG_ADMIN"] = "org_admin";
    UserRole["MEMBER"] = "member";
})(UserRole || (exports.UserRole = UserRole = {}));
var UserStatus;
(function (UserStatus) {
    UserStatus["ACTIVE"] = "active";
    UserStatus["INACTIVE"] = "inactive";
    UserStatus["SUSPENDED"] = "suspended";
})(UserStatus || (exports.UserStatus = UserStatus = {}));
const userSchema = new mongoose_1.default.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 50,
        index: true,
    },
    password: {
        type: String,
        required: true,
        minlength: 6,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        index: true,
    },
    role: {
        type: String,
        enum: Object.values(UserRole),
        default: UserRole.MEMBER,
        required: true,
    },
    organizationId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'Organization',
        index: true,
        // super_admin 不需要 organizationId，其他角色必须有
        required: function () {
            return this.role !== UserRole.SUPER_ADMIN;
        },
    },
    status: {
        type: String,
        enum: Object.values(UserStatus),
        default: UserStatus.ACTIVE,
        required: true,
    },
    lastLoginAt: {
        type: Date,
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
    },
    boundAppId: {
        type: String, // 用户绑定的 Facebook App ID
    },
}, {
    timestamps: true,
    toJSON: {
        transform: function (doc, ret) {
            // 不返回密码
            delete ret.password;
            return ret;
        },
    },
});
// 密码加密中间件
userSchema.pre('save', async function () {
    // 只在密码被修改时才加密
    if (!this.isModified('password')) {
        return;
    }
    const salt = await bcryptjs_1.default.genSalt(10);
    this.password = await bcryptjs_1.default.hash(this.password, salt);
});
// 比较密码的方法
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcryptjs_1.default.compare(candidatePassword, this.password);
};
// 索引
userSchema.index({ username: 1, email: 1 });
userSchema.index({ organizationId: 1, status: 1 });
userSchema.index({ role: 1 });
exports.default = mongoose_1.default.model('User', userSchema);
