"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("../controllers/auth.controller"));
const auth_1 = require("../middlewares/auth");
const router = (0, express_1.Router)();
// 公开路由
router.post('/login', auth_controller_1.default.login.bind(auth_controller_1.default));
router.post('/logout', auth_controller_1.default.logout.bind(auth_controller_1.default));
// 需要认证的路由
router.get('/me', auth_1.authenticate, auth_controller_1.default.getCurrentUser.bind(auth_controller_1.default));
router.post('/change-password', auth_1.authenticate, auth_controller_1.default.changePassword.bind(auth_controller_1.default));
exports.default = router;
