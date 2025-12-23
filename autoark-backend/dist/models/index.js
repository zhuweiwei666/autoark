"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutomationJob = exports.FacebookApp = exports.FacebookUser = exports.Product = exports.AdMaterialMapping = exports.MaterialMetrics = exports.Folder = exports.Material = exports.AdTask = exports.AdDraft = exports.CreativeGroup = exports.CopywritingPackage = exports.TargetingPackage = exports.SyncLog = exports.Rule = exports.OpsLog = exports.MetricsDaily = exports.Creative = exports.Campaign = exports.AdSet = exports.Ad = exports.Account = void 0;
var Account_1 = require("./Account");
Object.defineProperty(exports, "Account", { enumerable: true, get: function () { return __importDefault(Account_1).default; } });
var Ad_1 = require("./Ad");
Object.defineProperty(exports, "Ad", { enumerable: true, get: function () { return __importDefault(Ad_1).default; } });
var AdSet_1 = require("./AdSet");
Object.defineProperty(exports, "AdSet", { enumerable: true, get: function () { return __importDefault(AdSet_1).default; } });
var Campaign_1 = require("./Campaign");
Object.defineProperty(exports, "Campaign", { enumerable: true, get: function () { return __importDefault(Campaign_1).default; } });
var Creative_1 = require("./Creative");
Object.defineProperty(exports, "Creative", { enumerable: true, get: function () { return __importDefault(Creative_1).default; } });
var MetricsDaily_1 = require("./MetricsDaily");
Object.defineProperty(exports, "MetricsDaily", { enumerable: true, get: function () { return __importDefault(MetricsDaily_1).default; } });
var OpsLog_1 = require("./OpsLog");
Object.defineProperty(exports, "OpsLog", { enumerable: true, get: function () { return __importDefault(OpsLog_1).default; } });
var Rule_1 = require("./Rule");
Object.defineProperty(exports, "Rule", { enumerable: true, get: function () { return __importDefault(Rule_1).default; } });
var SyncLog_1 = require("./SyncLog");
Object.defineProperty(exports, "SyncLog", { enumerable: true, get: function () { return __importDefault(SyncLog_1).default; } });
// 批量广告创建相关模型
var TargetingPackage_1 = require("./TargetingPackage");
Object.defineProperty(exports, "TargetingPackage", { enumerable: true, get: function () { return __importDefault(TargetingPackage_1).default; } });
var CopywritingPackage_1 = require("./CopywritingPackage");
Object.defineProperty(exports, "CopywritingPackage", { enumerable: true, get: function () { return __importDefault(CopywritingPackage_1).default; } });
var CreativeGroup_1 = require("./CreativeGroup");
Object.defineProperty(exports, "CreativeGroup", { enumerable: true, get: function () { return __importDefault(CreativeGroup_1).default; } });
var AdDraft_1 = require("./AdDraft");
Object.defineProperty(exports, "AdDraft", { enumerable: true, get: function () { return __importDefault(AdDraft_1).default; } });
var AdTask_1 = require("./AdTask");
Object.defineProperty(exports, "AdTask", { enumerable: true, get: function () { return __importDefault(AdTask_1).default; } });
// 素材管理
var Material_1 = require("./Material");
Object.defineProperty(exports, "Material", { enumerable: true, get: function () { return __importDefault(Material_1).default; } });
var Folder_1 = require("./Folder");
Object.defineProperty(exports, "Folder", { enumerable: true, get: function () { return __importDefault(Folder_1).default; } });
var MaterialMetrics_1 = require("./MaterialMetrics");
Object.defineProperty(exports, "MaterialMetrics", { enumerable: true, get: function () { return __importDefault(MaterialMetrics_1).default; } });
var AdMaterialMapping_1 = require("./AdMaterialMapping");
Object.defineProperty(exports, "AdMaterialMapping", { enumerable: true, get: function () { return __importDefault(AdMaterialMapping_1).default; } });
// 产品关系映射（自动投放核心）
var Product_1 = require("./Product");
Object.defineProperty(exports, "Product", { enumerable: true, get: function () { return __importDefault(Product_1).default; } });
// Facebook 授权用户（缓存 Pixels、账户等）
var FacebookUser_1 = require("./FacebookUser");
Object.defineProperty(exports, "FacebookUser", { enumerable: true, get: function () { return __importDefault(FacebookUser_1).default; } });
// Facebook App 管理（支持多App负载均衡）
var FacebookApp_1 = require("./FacebookApp");
Object.defineProperty(exports, "FacebookApp", { enumerable: true, get: function () { return __importDefault(FacebookApp_1).default; } });
// 自动化 Job（AI Planner/Executor & 幂等任务编排）
var AutomationJob_1 = require("./AutomationJob");
Object.defineProperty(exports, "AutomationJob", { enumerable: true, get: function () { return __importDefault(AutomationJob_1).default; } });
