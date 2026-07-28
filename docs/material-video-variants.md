# AI 视频素材变体：AutoArk ↔ ai-host-v2 契约

## 目标与边界

该链路用于在保留广告主体和产品事实的前提下，生成构图、光线、场景或镜头运动不同的视频创意，供人工比较和投放实验。

- 不以绕过 Meta/Facebook 审核、哈希去重或内容政策为目标。
- 结果只进入 AutoArk 素材库，不会自动创建或发布广告。
- 每个生成结果都保留父素材、根素材、生成任务和参数血缘，并以 `reviewStatus=pending` 等待人工审核。
- 当前补齐的是视频转视频；既有文生图、图生图和图生视频能力不经过此契约。

## 请求与回调链路

1. 组织管理员在素材库选择一个 `video` 素材并提交变体参数。
2. AutoArk 接收 `POST /api/material-variants`，要求 8–128 字符的 `Idempotency-Key`。
3. AutoArk 写入 `MaterialVariantJob`，再调用 ai-host-v2：

   ```http
   POST {AI_HOST_GENERATION_BASE_URL}/api/v1/jobs
   X-API-Key: {AI_HOST_GENERATION_API_KEY}
   Content-Type: application/json
   ```

   ```json
   {
     "externalId": "autoark-material-variant:<uuid>",
     "idempotencyKey": "<stable upstream key>",
     "capability": "video_edit",
     "priority": 20,
     "resultUrlPolicy": "permanent",
     "callbackUrl": "<AUTOARK_PUBLIC_BASE_URL>/api/internal/generation/material-variants/callback",
     "input": {
       "sourceVideoUrl": "<parent material storage URL>",
       "prompt": "<creative instruction>",
       "durationSeconds": 3,
       "frameRate": 16,
       "strength": 0.85,
       "preserveAudio": true,
       "aspectRatio": "9:16"
     }
   }
   ```

4. ai-host-v2 将 `video_edit` 固定路由到：

   - provider：`comfyui-vace`
   - pipeline：`video_edit`
   - GPU role：`video-edit`
   - pool：`video-edit-default`

5. ai-host-v2 先把源视频和可选参考图上传到目标 ComfyUI 节点，再执行原生 `WanVaceToVideo` 工作流。生成窗口为 2–5 秒，默认 16fps，帧数按 `4n+1` 对齐；可选保留原音轨。
6. `resultUrlPolicy=permanent` 完成持久化后，ai-host-v2 对原始 JSON 请求体做 HMAC-SHA256，并回调：

   ```http
   POST /api/internal/generation/material-variants/callback
   X-Signature: <hex hmac>
   X-Job-Id: <generation job id>
   X-Delivery-Id: <delivery id>
   ```

7. AutoArk 用完全相同的原始请求体验签，按 delivery/fingerprint 和唯一索引去重，创建 `source.type=ai_variant` 的子素材。

网络超时发生在提交阶段时，本地任务进入 `submission_unknown`。使用同一个幂等键重试，AutoArk 和 ai-host-v2 都不会重复创建业务任务。

## 配置

AutoArk 后端必须配置前四项；超时项可选：

```dotenv
AI_HOST_GENERATION_BASE_URL=https://<generation-host>
AI_HOST_GENERATION_API_KEY=<dedicated tenant api key>
AI_HOST_GENERATION_HMAC_SECRET=<same tenant hmac secret>
AUTOARK_PUBLIC_BASE_URL=https://<public-autoark-host>
# optional
AI_HOST_GENERATION_TIMEOUT_MS=15000
```

缺少任意必要配置时接口会失败关闭，前端不会把能力显示为可用。

ai-host-v2 必须存在一个独立、启用的内部 tenant：

- `allowedCapabilities` 包含 `video_edit`
- API key 与 AutoArk 的 `AI_HOST_GENERATION_API_KEY` 相同
- HMAC secret 与 AutoArk 的 `AI_HOST_GENERATION_HMAC_SECRET` 相同

专用 GPU 节点通过 onboarding key `video-edit-vace` 接入。脚本只会在以下检查通过后把节点注册到 staging：

- ComfyUI 和 VideoHelperSuite 可加载；
- 工作流所需节点全部存在；
- 三个必需模型文件与私有 R2 对象字节数一致，且 VACE 主模型匹配固定上游 SHA256；
- ComfyUI `object_info` 能看到配置的模型名。

默认模型契约：

```text
diffusion_models/wan2.1_vace_14B_fp16.safetensors
text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors
vae/wan_2.1_vae.safetensors
```

商业素材默认只使用 Apache-2.0 VACE 基座，参数采用官方模板加入 CausVid 前的基线：20 steps、CFG 4、shift 8、`uni_pc`、`simple`。当前官方模板使用的 CausVid 上游 Hub 许可元数据标为 CC-BY-NC-4.0，因此本链路不默认下载或加载它；只有明确配置且完成商业许可核验的蒸馏 LoRA 才会启用 4-step 模式。参考资料：

- [ComfyUI Wan2.1 VACE 教程](https://docs.comfy.org/tutorials/video/wan/vace)
- [ComfyUI 官方 VACE 14B V2V 模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_wan_vace_14B_v2v.json)
- [ComfyUI VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)

## 上线验收

代码构建或单元测试通过不代表运行时已就绪。按以下顺序验收：

1. 确认私有 R2 中三个必需文件的精确文件名及字节数，并核对 VACE 主模型 SHA256。
2. 接入专用 GPU，确认 registry、直接 `/system_stats` 和 `object_info` 均通过。
3. 确认节点最终位于 `video-edit-default` 且 capability 为 `video_edit`。
4. 用测试 tenant 提交 2 秒、16fps 的永久结果任务，确认实际输出 MP4 可下载。
5. 确认 AutoArk 收到有效 HMAC 回调且只生成一个子素材。
6. 确认子素材显示 AI 血缘和“待人工审核”，且没有触发任何 Meta 发布调用。
