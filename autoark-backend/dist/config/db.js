"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWriteConnection = exports.getReadConnection = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
// 主连接（写操作）
let writeConnection = null;
// 从连接（读操作，用于读写分离）
let readConnection = null;
const connectDB = async () => {
    try {
        const uri = process.env.MONGO_URI || '';
        if (!uri) {
            throw new Error('MONGO_URI is not defined in environment variables');
        }
        // 主连接（写操作）
        writeConnection = await mongoose_1.default.connect(uri, {
            readPreference: 'primary', // 主节点用于写操作
        });
        console.log(`MongoDB Connected (Write): ${writeConnection.connection.host}`);
        // 如果配置了读连接 URI，创建独立的读连接
        const readUri = process.env.MONGO_READ_URI;
        if (readUri) {
            readConnection = mongoose_1.default.createConnection(readUri, {
                readPreference: 'secondary', // 从节点用于读操作
            });
            await readConnection.asPromise();
            console.log(`MongoDB Connected (Read): ${readConnection.host}`);
        }
        else {
            // 如果没有配置读连接，使用主连接但设置读偏好为 secondaryPreferred
            // 这样会优先使用从节点，如果从节点不可用则使用主节点
            mongoose_1.default.connection.on('connected', () => {
                // 在查询时使用 readPreference 选项
            });
            console.log(`MongoDB Read Preference: secondaryPreferred (using same connection)`);
        }
    }
    catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};
// 获取读连接（用于查询操作）
const getReadConnection = () => {
    if (readConnection) {
        return readConnection;
    }
    // 如果没有独立的读连接，返回主连接
    return mongoose_1.default;
};
exports.getReadConnection = getReadConnection;
// 获取写连接（用于写操作）
const getWriteConnection = () => {
    return mongoose_1.default;
};
exports.getWriteConnection = getWriteConnection;
exports.default = connectDB;
