"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
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
    app.use('/assets', express_1.default.static(path_1.default.join(frontendDistPath, 'assets')));
    // Serve root static files (favicon, etc.)
    app.use(express_1.default.static(frontendDistPath));
    // Fallback to index.html for client-side routing (React Router)
    // This must be before 404 handler but after all API routes
    // Use app.use instead of app.get('*') for Express 5.x compatibility
    app.use((req, res, next) => {
        // Skip API routes and dashboard route - let them be handled by their routes or 404
        if (req.path.startsWith('/api') || req.path.startsWith('/dashboard')) {
            return next();
        }
        // Skip if it's a static file request (likely 404 if we reached here)
        // But we want to be careful not to block valid routes
        if (req.path.includes('.') && !req.path.endsWith('.html')) {
            return next();
        }
        // For all other routes, serve the React app (for client-side routing)
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
