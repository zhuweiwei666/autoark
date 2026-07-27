import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/pages/AssetManagementPage.tsx', import.meta.url),
  'utf8',
)

test('asset material picker exposes every paginated material instead of only the first page', () => {
  assert.match(source, /params\.set\('page', String\(page\)\)/)
  assert.match(source, /setMaterials\(current => append \?/)
  assert.match(source, /materials\.length < materialTotal/)
  assert.match(source, /loadMaterials\(materialFilter, materialPage \+ 1, true\)/)
})
