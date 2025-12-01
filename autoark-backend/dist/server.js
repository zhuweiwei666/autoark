"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
require("./cron"); // Importing for side-effects if needed, though initCronJobs is explicit below
const cron_1 = __importDefault(require("./cron"));
const logger_1 = __importDefault(require("./utils/logger"));
const PORT = process.env.PORT || 3001;
// Handle Uncaught Exceptions
process.on('uncaughtException', (err) => {
    logger_1.default.error('UNCAUGHT EXCEPTION! 💥 Shutting down...', err);
    process.exit(1);
});
// Handle Unhandled Rejections
process.on('unhandledRejection', (err) => {
    logger_1.default.error('UNHANDLED REJECTION! 💥 Shutting down...', err);
    // Ideally we should close the server gracefully, but process.exit is acceptable here
    process.exit(1);
});
// Initialize Cron Jobs
(0, cron_1.default)();
app_1.default.listen(PORT, () => console.log(`AutoArk backend running on port ${PORT}`));
