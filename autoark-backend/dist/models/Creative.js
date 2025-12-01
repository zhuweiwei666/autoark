"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const creativeSchema = new mongoose_1.default.Schema({
    channel: String,
    creativeId: String,
    type: String,
    hash: String,
    storageUrl: String,
    duration: Number,
    width: Number,
    height: Number,
    tags: [String],
    createdBy: String,
}, { timestamps: true });
exports.default = mongoose_1.default.model('Creative', creativeSchema);
