"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFacebookAccessToken = void 0;
const FbToken_1 = __importDefault(require("../models/FbToken"));
const getFacebookAccessToken = async () => {
    const saved = await FbToken_1.default.findOne({ userId: 'default-user' });
    if (!saved)
        throw new Error('Facebook token not found. Please set it in Settings.');
    return saved.token;
};
exports.getFacebookAccessToken = getFacebookAccessToken;
