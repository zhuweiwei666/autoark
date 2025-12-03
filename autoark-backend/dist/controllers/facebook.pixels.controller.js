"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPixelEvents = exports.getPixelDetails = exports.getPixels = void 0;
const pixelsService = __importStar(require("../services/facebook.pixels.service"));
/**
 * 获取所有 Pixels
 */
const getPixels = async (req, res, next) => {
    try {
        const { tokenId, allTokens } = req.query;
        let pixels;
        if (allTokens === 'true') {
            // 获取所有 Token 的 Pixels
            pixels = await pixelsService.getAllPixelsFromAllTokens();
        }
        else if (tokenId) {
            // 获取指定 Token 的 Pixels
            pixels = await pixelsService.getPixelsByToken(tokenId);
        }
        else {
            // 使用 Token Pool 自动选择
            pixels = await pixelsService.getAllPixels();
        }
        res.json({
            success: true,
            data: pixels,
            count: pixels.length,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPixels = getPixels;
/**
 * 获取 Pixel 详情
 */
const getPixelDetails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tokenId } = req.query;
        const pixel = await pixelsService.getPixelDetails(id, tokenId);
        res.json({
            success: true,
            data: pixel,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPixelDetails = getPixelDetails;
/**
 * 获取 Pixel 事件
 */
const getPixelEvents = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { tokenId, limit } = req.query;
        const events = await pixelsService.getPixelEvents(id, tokenId, limit ? parseInt(limit) : 100);
        res.json({
            success: true,
            data: events,
            count: events.length,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getPixelEvents = getPixelEvents;
