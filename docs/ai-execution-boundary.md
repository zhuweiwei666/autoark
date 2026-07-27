# AutoArk AI 投手执行边界

## 核心原则

真人投手的 Meta 数据只用于学习上下文。AI 可以分析广告结构、素材表现、国家、版位和高转化小时，但不能操作或继承真人投手的 Meta 资产。

AI 投放必须由管理员创建 `AiExecutionMandate`（投放授权单）。没有有效授权单，不能创建、审批、发布或执行 AI 广告任务。

## 哪些可以复用

| 来源方法 | AutoArk 执行资产 | 处理方式 |
| --- | --- | --- |
| 广告结构 | ReplicaRun blueprint | 复用 Campaign、AdSet、Ad 层级与优化方法 |
| 国家和通用定向 | TargetingPackage | 去除账户专属定向后保存为 portable |
| 版位表现 | TargetingPackage deliveryInsights | 保存排名和来源定向，供执行与审核 |
| 高转化小时 | TargetingPackage deliveryInsights | 仅作为账户时区下的建议，不自动开关广告 |
| 高表现素材 | CreativeGroup | 仅保留稳定 URL，到目标账户重新上传 |

## 哪些绝不复用

- 真人投手的 Facebook Token、广告账户、Page 和 Pixel
- custom audience、saved audience 等账户专属受众
- Facebook creative ID、image hash、video ID
- 来源文案和来源落地页

来源文案只参与方法分析，不会自动生成执行文案包。

## 管理员必须提供的执行条件

1. 选择一份可执行的打法版本。
2. 将打法提炼为 portable TargetingPackage 和 CreativeGroup。
3. 选择 AutoArk CopywritingPackage。该文案包决定产品和投放链接。
4. 明确分配组织级 Meta System User（推荐）或非来源的独立个人 Token，以及广告账户和每个账户的 Page。
5. 系统从 Product.accounts[].throughPixelId 解析每个账户的 Pixel。
6. Product.pixels 中对应 Pixel 必须由管理员标记为 verified。
7. Pixel 必须存在于同一执行凭证的当前资产授权中；System User 必须同时覆盖目标账户、Page 和 Pixel。
8. 管理员设置默认日预算和授权上限。

全部通过后才能创建有效授权单。

## 执行工作流

1. AI 使用授权单创建 ReplicaRun 和不可变执行快照。
2. AutoArk 草稿中的 Campaign、AdSet 和 Ad 全部锁定为 `PAUSED`。
3. 创建草稿不会调用 Meta 写接口。
4. 管理员明确审批后，才能请求 Meta 创建 PAUSED 对象。
5. 发布入口再次验证授权单、产品、账户、Page、Pixel、预算和冻结资产。
6. Worker 在实际 Meta 写入前重新解析授权单，复核执行凭证、账户、Page、产品 Pixel、预算和方法资产；System User 若失效、密文不可解密或资产授权被收回则立即阻断。
7. Worker 同时校验审批时冻结的定向、素材与文案快照，防止排队后被改包。
8. 撤销授权单或修改任一关键绑定后，未执行的排队任务会在 Worker 写入前被阻断。

通用批量发布、失败重试和任务重跑都不能用于 AI 草稿。需要重跑时，必须先核对 Meta 已创建对象，再使用当前有效授权单创建新的 ReplicaRun。

## 当前自动化边界

- 自动学习和分析：支持。
- 自动生成 AutoArk PAUSED 草稿：支持。
- 人工审批后自动创建 Meta PAUSED 对象：支持。
- 自动启用广告：不支持。
- 自动放量：不支持。
- 按高转化小时自动开关：暂不支持；当前只保存建议。
