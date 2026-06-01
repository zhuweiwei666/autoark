## 2025-12-01
- 创建日志文件并初始化记录规则 (Auto Write Project Log + Auto Git Commit Rules)
- 清理旧自动部署服务记录，部署统一收敛到 Docker Compose 脚本
- 修复 dashboard 聚合管道类型错误
- 实现 Facebook 动态 Token 管理与自动账户发现功能
- 完善 CI/CD 流程与测试框架配置
### 2025-12-01
- Updated: src/utils/logger.ts, src/middlewares/errorHandler.ts, src/app.ts
- Reason: Implement global error handling middleware and Winston logging system (info/error/cron logs).
