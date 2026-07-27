import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const assetPage = readFileSync(new URL('../src/pages/AssetManagementPage.tsx', import.meta.url), 'utf8')

test('targeting packages expose and persist the dynamic creative switch', () => {
  assert.match(assetPage, /开启动态素材/)
  assert.match(assetPage, /formData\.dynamicCreativeEnabled === true/)
  assert.match(assetPage, /dynamicCreativeEnabled: e\.target\.checked/)
  assert.match(assetPage, /使用此定向包创建广告时，一个广告自动聚合多条素材/)
})
