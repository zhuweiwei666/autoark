# Facebook 商用准备清单

这份清单用于把 AutoArk 从内部可用推进到客户可授权、可交付、可排障的商用状态。

## 1. Meta App 必备配置

在 Meta Developer 后台确认：

- App Mode: Live
- App Domains: `app.autoark.work`
- Website URL: `https://app.autoark.work/`
- Privacy Policy URL: 可公开访问
- Terms of Service URL: 可公开访问
- User Data Deletion: 已配置说明页或 callback
- Facebook Login for Business configuration ID: 已写入生产环境
- Valid OAuth Redirect URIs:
  - `https://app.autoark.work/api/bulk-ad/auth/callback`
  - `https://app.autoark.work/api/facebook/oauth/callback`

## 2. 必须通过的高级权限

这些权限必须全部为 Advanced + Approved，AutoArk 才应标记为 Public OAuth Ready：

- `ads_management`
- `ads_read`
- `business_management`
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`

不要为当前广告创建流程额外申请 `pages_read_user_content`，除非产品已经提供读取主页用户评论、评分、被标记内容或 UGC 内容的功能。

## 3. 过审当天操作

权限通过后按顺序执行：

1. 在 Meta 后台确认所有权限为 Advanced + Approved。
2. 确认 App 已切到 Live。
3. 在 AutoArk 的 App 管理页更新合规状态：
   - appMode: live
   - businessVerification: verified
   - appReview: approved
   - 所有必备权限 access=advanced, status=approved
4. 确认 AutoArk 显示 Public OAuth Ready。
5. 使用非 App 管理员的 Facebook 账号跑一遍完整授权。
6. 使用低预算测试账户创建一条测试广告任务。
7. 在 AutoArk 任务管理页确认任务状态正常。
8. 在 Meta Ads Manager 确认 campaign/ad set/ad 已创建。

## 4. 客户接入前置条件

客户需要提前准备：

- 客户 Facebook 账号可正常登录，建议开启 2FA。
- 客户拥有或被授权访问对应 Business。
- 客户拥有或被授权访问广告账户。
- 客户拥有或被授权访问 Facebook Page。
- 客户拥有或被授权访问 Pixel/Dataset。
- 广告账户可正常投放，无欠费、风控、禁用或支付问题。
- Page 可用于投放，未被限制广告功能。
- Pixel/Dataset 与广告账户和 Business 关系正常。
- 客户准备可投放素材、落地页、预算和投放国家。

## 5. 客户接入流程

1. 在 AutoArk 为客户创建组织和用户。
2. 客户登录 `https://app.autoark.work`。
3. 进入创建广告页面。
4. 点击 Facebook 登录。
5. 客户在 Meta 授权页面确认授权。
6. 回到 AutoArk 后选择产品、Pixel、广告账户、Page 和素材。
7. 提交小预算测试广告任务。
8. AutoArk 任务成功后，再放开更大预算或更多账户。

## 6. 商用验收脚本

每次权限、配置或部署变更后，至少跑下面的验收：

- Facebook 授权 URL 包含 `config_id`，不再直接携带 `scope`。
- OAuth 回调地址为 `/api/bulk-ad/auth/callback`。
- 非 App 管理员账号可以授权。
- 授权后 AutoArk 能展示广告账户。
- 选择广告账户后能加载 Pixel。
- 选择广告账户后能加载 Page。
- 草稿校验能通过。
- 发布任务能创建 campaign/ad set/ad。
- 任务管理页能展示任务进度。
- 广告系列页或 Meta Ads Manager 能看到创建结果。

## 7. 常见失败原因

- `redirect_uri_mismatch`: Meta 后台没有配置对应 OAuth Redirect URI。
- `功能不可用`: App 未 Live、Business Login config 配置异常，或 App 仍在审核/更新。
- `API access blocked`: Marketing API 权限、Access Tier、App Review 或广告账户状态存在限制。
- 看不到广告账户: 客户账号没有广告账户权限，或授权时没有选择对应 Business 资产。
- 看不到 Page: 客户没有 Page 管理权限，或缺少 `pages_show_list` / `pages_read_engagement` / `pages_manage_ads`。
- 看不到 Pixel: Pixel/Dataset 不属于该 Business 或广告账户没有访问权限。
- 发布失败: 广告账户欠费、风控、Page 限制、素材不合规、预算/国家/版位配置不合法。

## 8. 支持信息收集

客户报错时先收集：

- AutoArk 用户邮箱
- Facebook 用户名或授权账号
- 广告账户 ID
- Page ID
- Pixel/Dataset ID
- 任务 ID 或草稿 ID
- 报错时间
- 页面截图
- Meta Ads Manager 里的账户状态截图

不要让客户提供 Facebook 密码、2FA 密钥、完整 access token 或支付卡信息。
