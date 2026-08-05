export const DUAL_SCENE_TEMPLATE_KEY = 'clingai_dual_scene_reveal_v1'

export const CREATIVE_FACTORY_TEMPLATES = [
  {
    key: DUAL_SCENE_TEMPLATE_KEY,
    version: 1,
    name: '单图双场景转化视频',
    description:
      '一张人物图自动生成私聊近景、泳池 SFW/NSFW 场景和 5 秒双层叠化广告。',
    inputMediaType: 'image' as const,
    outputMediaType: 'video' as const,
    aspectRatio: '9:16',
    variantsPerAsset: 1,
    steps: [
      'SFW 私聊近景',
      'SFW 泳池场景',
      'NSFW 泳池场景',
      '双路图生视频',
      '固定叠化、ClingAI 文案与音轨',
    ],
    generation: {
      imageTemplateId: 'creative-factory-custom',
      sfwVideoTemplateId: 'photoToVideo-sfw-natural-spokesperson-v20260727',
      nsfwVideoTemplateId: 'vid-695fbdd460c31ecfb4e0c814',
      closeupPrompt:
        'Edit the uploaded image into a tight close-up handheld selfie portrait of the same clearly adult woman. Preserve her exact facial identity and hair. Crop chest-up, face fills about half the vertical frame, camera at arm length and slightly above eye level. Put her in a cozy pink and magenta neon bedroom with soft practical lights and shallow depth of field. She wears a tasteful fitted black camisole and a subtle bunny-ear headband. Natural skin, realistic phone-camera texture, candid social-video first frame. No text, no logos, no watermark, no extra people.',
      poolSfwPrompt:
        'Edit the uploaded image into a different vertical swimming-pool scene with the same clearly adult woman. Preserve her exact facial identity and long hair. Show a medium-wide waist-up view with her standing in turquoise pool water, wearing a simple black bikini top, warm sunset hotel pool background, wet hair, playful candid expression, realistic handheld phone-camera look. This must be a distinctly different environment and camera framing from a bedroom selfie. No text, no logos, no watermark, no extra people.',
      poolNsfwPrompt:
        'Remove the black bikini top from the same clearly adult woman while preserving her exact face, wet hair, body proportions, pose, arm position, pool water, sunset lighting, camera angle and background. Realistic topless adult pool selfie, natural anatomy and skin texture. Do not crop closer. No text, no logos, no watermark, no extra people.',
    },
    composition: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 5,
      revealStartSeconds: 0.233333,
      revealEndSeconds: 2.8,
      revealOpacity: 0.56,
      title: 'ClingAI private chat',
      audioUrlEnv: 'CREATIVE_FACTORY_DUAL_SCENE_AUDIO_URL',
    },
  },
] as const

export type CreativeFactoryTemplate =
  (typeof CREATIVE_FACTORY_TEMPLATES)[number]

export const getCreativeFactoryTemplate = (key: unknown) =>
  CREATIVE_FACTORY_TEMPLATES.find(
    (template) => template.key === String(key || '').trim(),
  )

export const listCreativeFactoryTemplates = () =>
  CREATIVE_FACTORY_TEMPLATES.map((template) => ({
    key: template.key,
    version: template.version,
    name: template.name,
    description: template.description,
    inputMediaType: template.inputMediaType,
    outputMediaType: template.outputMediaType,
    aspectRatio: template.aspectRatio,
    variantsPerAsset: template.variantsPerAsset,
    steps: template.steps,
  }))
