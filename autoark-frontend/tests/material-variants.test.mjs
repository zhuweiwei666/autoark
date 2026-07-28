import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const readSource = relativePath =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

describe('material video variants', () => {
  it('submits with an idempotency key and polls the dedicated task endpoint', () => {
    const service = readSource('src/services/materialVariants.ts')
    const panel = readSource('src/components/MaterialVariantPanel.tsx')

    assert.match(service, /['"]\/api\/material-variants['"]/)
    assert.match(service, /['"]Idempotency-Key['"]:\s*idempotencyKey/)
    assert.match(service, /crypto\.randomUUID/)
    assert.match(panel, /getMaterialVariant\(job\._id/)
    assert.match(panel, /setTimeout\(poll,\s*5000\)/)
  })

  it('exposes bounded VACE controls and states that results are never auto-published', () => {
    const panel = readSource('src/components/MaterialVariantPanel.tsx')

    assert.match(panel, /VACE · 低优先级队列/)
    assert.match(panel, /\{\[2,\s*3,\s*4,\s*5\]\.map/)
    assert.match(panel, /min="0\.1"/)
    assert.match(panel, /max="1"/)
    assert.match(panel, /保留原视频音轨/)
    assert.match(panel, /结果只进入素材库，需人工审核后再投放/)
    assert.match(panel, /请勿用视觉扰动、隐藏帧等方式规避平台审核/)
  })

  it('shows the action only to admins and labels AI lineage in the material library', () => {
    const page = readSource('src/pages/MaterialLibraryPage.tsx')

    assert.match(page, /isSuperAdmin\s*\|\|\s*user\?\.role\s*===\s*['"]org_admin['"]/)
    assert.match(page, /canCreateVideoVariants && viewMaterial\.type === ['"]video['"]/)
    assert.match(page, /<MaterialVariantPanel/)
    assert.match(page, /material\.source\?\.type === ['"]ai_variant['"]/)
    assert.match(page, /待人工审核/)
  })
})
