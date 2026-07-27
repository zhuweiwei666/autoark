import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const library = readFileSync(new URL('../src/pages/MaterialLibraryPage.tsx', import.meta.url), 'utf8')
const picker = readFileSync(new URL('../src/pages/AssetManagementPage.tsx', import.meta.url), 'utf8')

test('material library supports personal favorites with filtering and optimistic feedback', () => {
  assert.match(library, /favoritesOnly/)
  assert.match(library, /materials\/\$\{material\._id\}\/favorite/)
  assert.match(library, /我的收藏/)
  assert.match(library, /aria-label=\{m\.isFavorite \? `取消收藏/)
})

test('creative package picker loads favorites first and marks them prominently', () => {
  assert.match(picker, /favoriteParams\.set\('favoritesOnly', 'true'\)/)
  assert.match(picker, /\[\.\.\.favoriteMaterials, \.\.\.nextMaterials\.filter/)
  assert.match(picker, /已收藏/)
})
