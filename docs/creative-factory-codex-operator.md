# Creative Factory Codex 执行协议

AutoArk 是任务和归因真相源，ai-host 是图片/视频生成器，Codex 是创意分析与媒体处理执行器。Codex 不直接写数据库，只通过签名 API 认领、规划、刷新和回写任务。

## 环境变量

```bash
export AUTOARK_URL=https://app.autoark.work
export CREATIVE_FACTORY_CODEX_SECRET=...
export CODEX_WORKER_ID=codex-mac-studio-01
```

`CREATIVE_FACTORY_CODEX_SECRET` 只给受控执行器，日志中禁止打印。模板读取和成品上传都使用任务签名；AutoArk 按任务所属组织签发专属 R2 路径，不需要通用用户 Token。

## 单任务流程

1. `node scripts/creative-factory-codex-client.mjs claim` 认领一个任务。
2. 检查来源素材和 `localInspection`。若存在素材示例且 `styleReference.analysis.status` 不是 `completed`，逐张检查示例抽帧并提取广告元素；同批后续任务直接复用已持久化的分析，不重复分析示例。
3. `node scripts/creative-factory-codex-client.mjs plan <jobId> plan.json`。按“来源 × 示例”矩阵执行：图片+图片直接图片处理；视频+图片截帧后处理；图片+视频先用 ai-host `featureKey=video` 图生视频；视频+视频直接剪辑。
4. 生成任务用 `refresh <jobId>` 等待 ai-host 返回 `succeeded`，把 `aiHost.resultUrl` 下载到本地。
5. 按 `editRecipe` 生成 recipe JSON，运行 `node scripts/creative-factory-media.mjs recipe.json`。
6. `upload <jobId> <成品文件>` 上传任务所属组织的专属 R2 路径，把输出 JSON 保存为 `output.json`。
7. 包装为 `{ "outputs": [<upload 输出>], "notes": "..." }`，执行 `complete <jobId> result.json`。
8. AutoArk 创建素材记录；发布广告时现有 `AdMaterialMapping` 会自动把广告、消耗、ROAS 回写到该生产任务。

受控 Mac 执行节点可直接运行：

```bash
# 处理一个任务，适合验收和人工观察
node scripts/creative-factory-codex-worker.mjs --once

# 连续认领队列，适合批量生产；用 launchd/systemd 托管进程
node scripts/creative-factory-codex-worker.mjs --loop
```

worker 每个任务启动一个隔离的非交互 Codex 会话，工作文件放在系统临时目录。短暂失败不会直接把任务判死，租约到期后其他 worker 可以继续认领。

## plan 最小格式

```json
{
  "intentSummary": "为美国冷流量制作 9:16 三秒强钩子素材",
  "audience": "18-34 岁 AI 创作工具用户",
  "hook": "Upload one photo. Turn it into motion.",
  "featureKey": "video",
  "templateId": "模板 ID，可留空使用默认模板",
  "rationale": "图片源先由 ai-host 保持人物一致性，再做品牌和节奏层剪辑",
  "referenceAnalysis": {
    "summary": "高对比冷色竖版广告，首秒大字钩子，快速切镜，末尾单一 CTA",
    "visualLanguage": "cool editorial, high contrast, product-first",
    "palette": ["#0B0F14", "#FFFFFF", "#22D3EE"],
    "typography": "粗体无衬线，短句，居中偏上",
    "layout": "主体居中，标题位于上三分之一，CTA 靠下",
    "hookPattern": "0-1 秒先给结果，再解释过程",
    "pacing": "每 0.8-1.2 秒一个视觉变化",
    "transitions": "硬切为主，轻微推近",
    "overlays": "高对比字幕块，避免遮挡人脸和产品",
    "callToAction": "Create with ClingAI",
    "audio": "短促节拍，切点跟随鼓点",
    "generationPrompt": "Preserve the source subject. Use energetic forward camera motion, cool high-contrast lighting and a result-first advertising rhythm.",
    "avoid": [
      "复制示例中的原品牌名称",
      "复制原 logo",
      "逐像素复刻受版权保护的版式"
    ]
  },
  "editRecipe": {
    "masks": [
      {
        "x": 0.72,
        "y": 0.02,
        "width": 0.25,
        "height": 0.08,
        "unit": "ratio",
        "color": "#111111"
      }
    ],
    "style": {
      "brightness": 1.0,
      "contrast": 1.15,
      "saturation": 0.92,
      "hue": 0
    },
    "textOverlays": [
      {
        "text": "Create it your way",
        "x": 0.08,
        "y": 0.12,
        "width": 0.84,
        "height": 0.16,
        "unit": "ratio",
        "color": "#ffffff",
        "background": "#111111",
        "backgroundOpacity": 0.82,
        "fontSizeRatio": 0.05,
        "start": 0,
        "end": 2.5
      }
    ],
    "brand": {
      "label": "ClingAI",
      "sublabel": "Create without limits",
      "background": "#111111",
      "color": "#ffffff"
    }
  }
}
```

`masks` 由 Codex 根据实际画面逐项确定，不能仅靠 OCR 文本命中；动态水印可在每个 mask 上增加 `start`/`end` 秒数并按位置拆段。图片和视频都支持 `brand.logoPath` 叠加 ClingAI 标识。验收至少检查首帧、中段、尾帧、音轨和导出尺寸。

图片成品如果来源是视频，recipe 必须同时声明 `"mediaType":"image"`、`"sourceMediaType":"video"`，并可用 `extractFrame.position`（0-1）或 `extractFrame.at`（秒）选择最有信息量的画面。`style.brightness` 对图片和视频都使用 1.0 为原值；`contrast`、`saturation` 同理。素材示例只用于提取可迁移的广告语言，任何示例中的商标、品牌名、人物身份和受版权保护的独特素材都不得复制到成品。
