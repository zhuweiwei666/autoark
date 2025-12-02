"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = __importDefault(require("./config/db"));
const facebook_routes_1 = __importDefault(require("./routes/facebook.routes"));
const dashboard_routes_1 = __importDefault(require("./routes/dashboard.routes"));
const facebook_sync_routes_1 = __importDefault(require("./routes/facebook.sync.routes"));
const fbToken_routes_1 = __importDefault(require("./routes/fbToken.routes"));
const logger_1 = __importDefault(require("./utils/logger"));
const sync_cron_1 = __importDefault(require("./cron/sync.cron"));
const cron_1 = __importDefault(require("./cron"));
const tokenValidation_cron_1 = __importDefault(require("./cron/tokenValidation.cron"));
const errorHandler_1 = require("./middlewares/errorHandler");
dotenv_1.default.config();
// Connect to DB
(0, db_1.default)();
// Initialize Crons
(0, cron_1.default)();
(0, sync_cron_1.default)();
(0, tokenValidation_cron_1.default)(); // Token validation cron (每小时检查一次)
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Request Logger
app.use((req, res, next) => {
    const start = Date.now();
    const { method, url } = req;
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger_1.default.info(`[${method}] ${url} ${res.statusCode} - ${duration}ms`);
    });
    next();
});
// API Routes
app.use('/api/facebook', facebook_routes_1.default);
app.use('/api/facebook', facebook_sync_routes_1.default);
app.use('/api/dashboard', dashboard_routes_1.default);
app.use('/api/fb-token', fbToken_routes_1.default); // Facebook token management
// Dashboard UI (accessible at /dashboard)
app.use('/dashboard', dashboard_routes_1.default);
app.get('/', (req, res) => {
    res.send('AutoArk Backend API is running');
});
// 404 Handler (must be after all routes, before errorHandler)
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.path} not found`,
    });
});
app.use(errorHandler_1.errorHandler);
exports.default = app;
