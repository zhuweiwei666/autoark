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
exports.saveCampaignColumns = exports.getCampaignColumns = void 0;
const userSettingsService = __importStar(require("../services/user.settings.service"));
// 假设用户 ID 可以从请求中获取，例如通过认证中间件。
// 这里我们暂时模拟一个 userId。
const MOCK_USER_ID = 'user_autoark_test_id';
const getCampaignColumns = async (req, res, next) => {
    try {
        const columns = await userSettingsService.getCampaignColumnSettings(MOCK_USER_ID);
        res.json({
            success: true,
            data: columns,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.getCampaignColumns = getCampaignColumns;
const saveCampaignColumns = async (req, res, next) => {
    try {
        const { columns } = req.body;
        if (!Array.isArray(columns)) {
            return res.status(400).json({ success: false, message: 'Columns must be an array.' });
        }
        const savedColumns = await userSettingsService.saveCampaignColumnSettings(MOCK_USER_ID, columns);
        res.json({
            success: true,
            message: 'Campaign columns saved successfully.',
            data: savedColumns,
        });
    }
    catch (error) {
        next(error);
    }
};
exports.saveCampaignColumns = saveCampaignColumns;
