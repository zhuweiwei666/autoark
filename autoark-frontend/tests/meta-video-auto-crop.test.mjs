import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const assetPage = readFileSync(
  new URL('../src/pages/AssetManagementPage.tsx', import.meta.url),
  'utf8',
)
const createPage = readFileSync(
  new URL('../src/pages/BulkAdCreatePage.tsx', import.meta.url),
  'utf8',
)
const optimizationModule = readFileSync(
  new URL('../src/utils/metaCreativeOptimization.ts', import.meta.url),
  'utf8',
)

test('creative packages expose one mutually exclusive Meta optimization selector', () => {
  assert.match(assetPage, /Meta 自动裁剪视频/)
  assert.match(assetPage, /Meta 云端智能优化/)
  assert.match(assetPage, /role="radiogroup"/)
  assert.match(assetPage, /metaCreativeOptimizationMode: option\.value/)
  assert.match(assetPage, /metaAutoCrop: option\.value !== 'off'/)
  assert.match(optimizationModule, /'off'/)
  assert.match(optimizationModule, /'auto_crop'/)
  assert.match(optimizationModule, /'advantage_plus'/)
  assert.match(assetPage, /是否裁剪及裁剪范围由 Meta 决定/)
  assert.match(assetPage, /不会修改素材库中的原视频/)
  assert.match(assetPage, /发布时自动关闭动态创意/)
})

test('creative package cards and publish selection show the effective Meta mode', () => {
  assert.match(assetPage, /getMetaCreativeOptimizationMode\(item\.config\)/)
  assert.match(assetPage, /Meta 自动裁剪/)
  assert.match(assetPage, /Meta 云端优化/)
  assert.match(createPage, /getMetaCreativeOptimizationMode\(group\.config\)/)
  assert.match(createPage, /Meta 云端智能优化会优先/)
  assert.match(createPage, /按每个素材创建独立广告/)
  assert.match(createPage, /selectedMetaCloudOptimization/)
})
