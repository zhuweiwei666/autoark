import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [pageSource, pickerSource, apiSource] = await Promise.all([
  readFile(new URL('../src/pages/CreativeFactoryPage.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/CreativeFactoryMaterialPicker.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/services/api.ts', import.meta.url), 'utf8'),
])

test('Creative Factory only accepts sources selected from the AutoArk material library', () => {
  assert.match(pageSource, /从素材库选择/)
  assert.match(pageSource, /selectedMaterials\.map\(\(material\) => \(\{ materialId: material\._id \}\)\)/)
  assert.doesNotMatch(pageSource, /sourceLines|URL 来源类型|HTTPS 素材 URL/)
})

test('material picker supports folder browsing, media filtering, pagination, and a hard batch limit', () => {
  assert.match(pickerSource, /MAX_SELECTED_MATERIALS = 20/)
  assert.match(pickerSource, /getMaterialLibraryFolders/)
  assert.match(pickerSource, /folder, type, search, page/)
  assert.match(pickerSource, /role="dialog"/)
  assert.match(pickerSource, /MaterialGridSkeleton/)
  assert.match(pickerSource, /素材加载失败/)
  assert.match(pickerSource, /这个范围内没有素材/)
})

test('material picker reads the existing organization-scoped material endpoints', () => {
  assert.match(apiSource, /\/api\/materials\/folder-tree/)
  assert.match(apiSource, /\/api\/materials\?\$\{params\}/)
})
