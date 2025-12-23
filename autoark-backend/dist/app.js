"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const facebook_routes_1 = __importDefault(require("./routes/facebook.routes"));
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const facebook_sync_routes_1 = __importDefault(require("./routes/facebook.sync.routes"));
const fbToken_routes_1 = __importDefault(require("./routes/fbToken.routes"));
const user_settings_routes_1 = __importDefault(require("./routes/user.settings.routes")); // New: User settings routes
const bulkAd_routes_1 = __importDefault(require("./routes/bulkAd.routes")); // New: Bulk ad creation routes
const material_routes_1 = __importDefault(require("./routes/material.routes")); // New: Material management routes
const materialMetrics_routes_1 = __importDefault(require("./routes/materialMetrics.routes")); // New: Material metrics & recommendations
const agent_controller_1 = __importDefault(require("./domain/agent/agent.controller")); // New: AI Agent routes
const summary_controller_1 = __importDefault(require("./controllers/summary.controller")); // New: 预聚合数据快速读取
const productMapping_routes_1 = __importDefault(require("./routes/productMapping.routes")); // New: 产品关系映射
const facebookApp_routes_1 = __importDefault(require("./routes/facebookApp.routes")); // New: Facebook App 管理
const auth_routes_1 = __importDefault(require("./routes/auth.routes")); // New: 认证路由
const user_routes_1 = __importDefault(require("./routes/user.routes")); // New: 用户管理路由
const organization_routes_1 = __importDefault(require("./routes/organization.routes")); // New: 组织管理路由
const account_management_routes_1 = __importDefault(require("./routes/account.management.routes")); // New: 账户管理路由
const aggregation_controller_1 = __importDefault(require("./controllers/aggregation.controller")); // New: 预聚合数据 API
const rule_controller_1 = __importDefault(require("./controllers/rule.controller")); // New: 自动化规则引擎
const materialAutoTest_controller_1 = __importDefault(require("./controllers/materialAutoTest.controller")); // New: 素材自动测试
const aiSuggestion_controller_1 = __importDefault(require("./controllers/aiSuggestion.controller")); // New: AI 优化建议
const automationJob_routes_1 = __importDefault(require("./routes/automationJob.routes")); // New: 自动化 Job 编排
const logger_1 = __importDefault(require("./utils/logger"));
const errorHandler_1 = require("./middlewares/errorHandler");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Request ID (Correlation ID)
app.use((req, res, next) => {
    const headerId = req.headers['x-request-id'];
    const requestId = typeof headerId === 'string' && headerId.trim().length > 0 ? headerId : (0, crypto_1.randomUUID)();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
});
// Request Logger
app.use((req, res, next) => {
    const start = Date.now();
    const { method, url } = req;
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger_1.default.info(`[${req.requestId}] [${method}] ${url} ${res.statusCode} - ${duration}ms`);
    });
    next();
});
// API Routes
// 认证路由（公开）
app.use('/api/auth', auth_routes_1.default);
// 用户和组织管理（需要认证）
app.use('/api/users', user_routes_1.default);
app.use('/api/organizations', organization_routes_1.default);
app.use('/api/account-management', account_management_routes_1.default);
// 其他业务路由
app.use('/api/facebook', facebook_routes_1.default);
app.use('/api/facebook', facebook_sync_routes_1.default);
app.use('/api/dashboard', dashboard_routes_1.default);
app.use('/api/fb-token', fbToken_routes_1.default); // Facebook token management
app.use('/api/user-settings', user_settings_routes_1.default); // New: User settings management
app.use('/api/bulk-ad', bulkAd_routes_1.default); // New: Bulk ad creation management
app.use('/api/materials', material_routes_1.default); // New: Material management
app.use('/api/material-metrics', materialMetrics_routes_1.default); // New: Material metrics & recommendations
app.use('/api/agent', agent_controller_1.default); // New: AI Agent
app.use('/api/summary', summary_controller_1.default); // New: 预聚合数据快速读取（加速前端页面）
app.use('/api/product-mapping', productMapping_routes_1.default); // New: 产品关系映射（自动投放核心）
app.use('/api/facebook-apps', facebookApp_routes_1.default); // New: Facebook App 管理（多App负载均衡）
app.use('/api/agg', aggregation_controller_1.default); // New: 统一预聚合数据 API（前端+AI 共用）
app.use('/api/rules', rule_controller_1.default); // New: 自动化规则引擎
app.use('/api/material-auto-test', materialAutoTest_controller_1.default); // New: 素材自动测试
app.use('/api/ai-suggestions', aiSuggestion_controller_1.default); // New: AI 优化建议
app.use('/api/automation-jobs', automationJob_routes_1.default); // New: AI Planner/Executor jobs
// Dashboard UI 已迁移到 React 前端，不再需要后端路由
// app.use('/dashboard', dashboardRoutes) // 已禁用，让前端 React Router 处理
// Serve frontend static files (if dist directory exists)
// Try multiple possible paths for frontend dist
const fs = require('fs');
const possiblePaths = [
    path_1.default.join(__dirname, '../../autoark-frontend/dist'), // Relative from dist/
    path_1.default.join(process.cwd(), 'autoark-frontend/dist'), // From project root
    path_1.default.join(process.cwd(), '../autoark-frontend/dist'), // From backend dir
    '/root/autoark/autoark-frontend/dist', // Absolute path on server
];
let frontendDistPath = null;
for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
        frontendDistPath = possiblePath;
        break;
    }
}
if (frontendDistPath) {
    logger_1.default.info(`Frontend static files served from: ${frontendDistPath}`);
    // Explicitly serve assets directory to ensure CSS/JS loading
    // Serve static assets with no-cache headers to prevent browser caching issues
    app.use('/assets', express_1.default.static(path_1.default.join(frontendDistPath, 'assets'), {
        setHeaders: (res, path) => {
            // For JS and CSS files, set no-cache to ensure fresh content
            if (path.endsWith('.js') || path.endsWith('.css')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));
    // Serve root static files (favicon, etc.) with no-cache for HTML
    app.use(express_1.default.static(frontendDistPath, {
        setHeaders: (res, path) => {
            // For HTML files, set no-cache to ensure fresh content
            if (path.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));
    // Fallback to index.html for client-side routing (React Router)
    // This must be before 404 handler but after all API routes
    // Use app.use instead of app.get('*') for Express 5.x compatibility
    app.use((req, res, next) => {
        // Skip API routes only - let frontend handle all other routes including /dashboard
        if (req.path.startsWith('/api')) {
            return next();
        }
        // Skip if it's a static file request (likely 404 if we reached here)
        // But we want to be careful not to block valid routes
        if (req.path.includes('.') && !req.path.endsWith('.html')) {
            return next();
        }
        // For all other routes (including /dashboard), serve the React app (for client-side routing)
        const indexPath = path_1.default.join(frontendDistPath, 'index.html');
        res.sendFile(indexPath, (err) => {
            if (err) {
                logger_1.default.error(`Error serving frontend index.html: ${err.message}`);
                next(err);
            }
        });
    });
}
else {
    logger_1.default.warn('Frontend dist directory not found. Tried paths:');
    possiblePaths.forEach(p => logger_1.default.warn(`  - ${p}`));
    logger_1.default.warn('Please build the frontend: cd autoark-frontend && npm run build');
    // Still provide a route for /fb-token to show helpful message
    app.get('/fb-token', (req, res) => {
        res.status(503).json({
            success: false,
            message: 'Frontend not built. Please build the frontend first: cd autoark-frontend && npm run build',
            pathsTried: possiblePaths,
        });
    });
    app.get('/', (req, res) => {
        res.send('AutoArk Backend API is running. Frontend not built yet. Please build: cd autoark-frontend && npm run build');
    });
}
// 404 Handler (must be after all routes, before errorHandler)
// This will only catch requests that weren't handled by API routes, dashboard, or frontend
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.path} not found`,
    });
});
app.use(errorHandler_1.errorHandler);
exports.default = app;
