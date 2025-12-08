"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrganizationStatus = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
var OrganizationStatus;
(function (OrganizationStatus) {
    OrganizationStatus["ACTIVE"] = "active";
    OrganizationStatus["INACTIVE"] = "inactive";
    OrganizationStatus["SUSPENDED"] = "suspended";
})(OrganizationStatus || (exports.OrganizationStatus = OrganizationStatus = {}));
const organizationSchema = new mongoose_1.default.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 2,
        maxlength: 100,
        index: true,
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500,
    },
    adminId: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: Object.values(OrganizationStatus),
        default: OrganizationStatus.ACTIVE,
        required: true,
    },
    settings: {
        maxMembers: {
            type: Number,
            default: 50,
        },
        features: {
            type: [String],
            default: [],
        },
    },
    createdBy: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
}, {
    timestamps: true,
});
// 索引
organizationSchema.index({ status: 1 });
organizationSchema.index({ adminId: 1 });
exports.default = mongoose_1.default.model('Organization', organizationSchema);
