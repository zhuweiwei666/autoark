import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const assetPage = readFileSync(
  new URL('../src/pages/AssetManagementPage.tsx', import.meta.url),
  'utf8',
)

test('creative packages expose and persist the Meta video auto-crop switch', () => {
  assert.match(assetPage, /Meta 自动裁剪视频/)
  assert.match(assetPage, /role="switch"/)
  assert.match(assetPage, /aria-checked=\{formData\.config\?\.metaAutoCrop === true\}/)
  assert.match(assetPage, /metaAutoCrop: formData\.config\?\.metaAutoCrop !== true/)
  assert.match(assetPage, /是否裁剪及裁剪范围由 Meta 决定/)
  assert.match(assetPage, /不会修改素材库中的原视频/)
})

test('creative package cards show when Meta video auto-crop is enabled', () => {
  assert.match(assetPage, /item\.config\?\.metaAutoCrop === true/)
  assert.match(assetPage, /Meta 自动裁剪/)
})
