"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const ruleSchema = new mongoose_1.default.Schema({
    name: String,
    channel: String,
    platform: String,
    scope: String,
    metric: String,
    operator: String,
    value: Number,
});
exports.default = mongoose_1.default.model('Rule', ruleSchema);
