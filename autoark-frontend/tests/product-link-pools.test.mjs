import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const layout = readFileSync(path.join(root, 'src/components/Layout.tsx'), 'utf8')
const page = readFileSync(path.join(root, 'src/pages/ProductLinkPoolsPage.tsx'), 'utf8')
const api = readFileSync(path.join(root, 'src/services/productLinkPools.ts'), 'utf8')

test('product link pools are an admin-only workflow with a navigation entry', () => {
  assert.match(
    app,
    /path="\/product-link-pools"[\s\S]*requireRole="org_admin"[\s\S]*<ProductLinkPoolsPage/,
  )
  assert.match(layout, /to:\s*"\/product-link-pools"[\s\S]*adminOnly:\s*true/)
})

test('operators can configure platform, URL, enabled state, and manual weight', () => {
  assert.match(page, /platform/)
  assert.match(page, /weight/)
  assert.match(page, /enabled/)
  assert.match(page, /iOS/)
  assert.match(page, /Android/)
  assert.match(page, /权重/)
})

test('the page uses the dedicated product-link-pool API and exposes the permanent short URL', () => {
  assert.match(api, /\/api\/product-link-pools/)
  assert.match(page, /shortUrl/)
  assert.match(page, /复制短链/)
})
