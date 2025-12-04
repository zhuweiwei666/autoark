# SSL 证书"不安全"警告修复指南

## 问题说明

浏览器显示"不安全"警告通常是因为 **Cloudflare 的 SSL/TLS 加密模式设置不正确**。

## 修复步骤

### 1. 检查 Cloudflare SSL/TLS 设置（最重要）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)
2. 选择域名 `app.autoark.work`
3. 进入 **SSL/TLS** 设置
4. 找到 **加密模式**（Encryption mode）
5. 确保设置为以下选项之一：
   - ✅ **Full**（推荐）
   - ✅ **Full (strict)**（如果证书完全匹配）

   ❌ **不要使用以下模式：**
   - Flexible（仅加密浏览器到 Cloudflare，不加密 Cloudflare 到源服务器）
   - Off（完全禁用加密）

### 2. 清除浏览器缓存

1. **Chrome/Edge:**
   - 按 `Ctrl+Shift+Delete` (Windows) 或 `Cmd+Shift+Delete` (Mac)
   - 选择"缓存的图片和文件"和"Cookie 和其他网站数据"
   - 时间范围选择"全部时间"
   - 点击"清除数据"

2. **Firefox:**
   - 按 `Ctrl+Shift+Delete`
   - 选择"缓存"和"Cookie"
   - 点击"立即清除"

### 3. 使用无痕模式测试

- Chrome: `Ctrl+Shift+N` (Windows) 或 `Cmd+Shift+N` (Mac)
- Firefox: `Ctrl+Shift+P` (Windows) 或 `Cmd+Shift+P` (Mac)
- 在无痕窗口中访问 `https://app.autoark.work`

### 4. 验证证书

在浏览器中：
1. 点击地址栏的锁图标
2. 点击"证书"
3. 检查证书信息：
   - 颁发者应该是 Cloudflare
   - 有效期应该到 2040 年

## 服务器端配置状态

✅ **已完成的配置：**
- SSL 证书已安装：`/etc/nginx/ssl/autoark/origin.crt`
- Nginx 已配置 HTTPS（443 端口）
- HTTP 自动重定向到 HTTPS
- 证书有效期：2025-12-03 至 2040-11-29

## 常见问题

### Q: 为什么证书验证返回码是 21？
A: 这是正常的。Cloudflare Origin Certificate 是自签名证书，只用于 Cloudflare 和源服务器之间的加密。浏览器看到的是 Cloudflare 的公共证书，不是源服务器的证书。

### Q: 设置 Full 模式后仍然显示不安全？
A: 
1. 等待 1-2 分钟让 Cloudflare 配置生效
2. 清除浏览器缓存
3. 使用无痕模式测试
4. 检查是否直接访问了源服务器 IP（应该访问域名）

### Q: 如何验证 Cloudflare 设置是否正确？
A: 访问 `https://www.ssllabs.com/ssltest/analyze.html?d=app.autoark.work` 进行 SSL 测试。

## 联系支持

如果按照以上步骤操作后问题仍然存在，请提供：
1. 浏览器控制台的错误信息（F12 → Console）
2. 证书详情截图
3. Cloudflare SSL/TLS 设置截图

