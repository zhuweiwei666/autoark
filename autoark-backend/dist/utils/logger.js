"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = {
    info: (message) => console.log(`[INFO] ${message}`),
    warn: (message) => console.warn(`[WARN] ${message}`),
    error: (message, error) => {
        console.error(`[ERROR] ${message}`);
        if (error) {
            if (error instanceof Error) {
                console.error(error.stack);
            }
            else {
                console.error(error);
            }
        }
    },
    timerLog: (label, startTime) => {
        const duration = Date.now() - startTime;
        console.log(`[TIMER] ${label} - ${duration}ms`);
    },
};
exports.default = logger;
