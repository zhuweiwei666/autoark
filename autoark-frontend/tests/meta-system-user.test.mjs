import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(path.join(root, 'src/pages/MetaSystemUserPage.tsx'), 'utf8')
const api = readFileSync(path.join(root, 'src/services/metaSystemUserApi.ts'), 'utf8')
const app = readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
const layout = readFileSync(path.join(root, 'src/components/Layout.tsx'), 'utf8')
const bulkAd = readFileSync(path.join(root, 'src/pages/BulkAdCreatePage.tsx'), 'utf8')

test('System User IAM is a super-admin-only workflow with explicit mutation confirmation', () => {
  assert.match(
    app,
    /path="\/meta-system-users"[\s\S]*requireRole="super_admin"[\s\S]*<MetaSystemUserPage/,
  )
  assert.match(layout, /to:\s*"\/meta-system-users"[\s\S]*superAdminOnly:\s*true/)
  assert.match(page, /const PROVISION_CONFIRMATION = 'PROVISION_SYSTEM_USER'/)
  assert.match(page, /生成只读执行计划/)
  assert.match(page, /执行授权并读回验证/)
})

test('the browser never receives a raw System User token', () => {
  assert.doesNotMatch(api, /accessToken:\s*string/)
  assert.doesNotMatch(page, /tokenCiphertext/)
  assert.match(page, /只展示不可逆指纹/)
})

test('bulk publishing pins System User credentials and removes the personal-token field', () => {
  assert.match(bulkAd, /authorizationType === 'system_user'/)
  assert.match(bulkAd, /draft\.metaCredentialId = facebookTokenId/)
  assert.match(bulkAd, /delete draft\.facebookTokenId/)
})
