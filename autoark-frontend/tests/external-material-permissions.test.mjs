import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const readSource = (relativePath) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

describe('external material permissions', () => {
  it('refreshes optional permissions from the authenticated user endpoint', () => {
    const auth = readSource('src/contexts/AuthContext.tsx')

    assert.match(auth, /permissions\?:\s*string\[\]/)
    assert.match(auth, /fetchWithTimeout\(['"]\/api\/auth\/me['"]/)
    assert.match(auth, /setUser\(data\.data\)/)
    assert.match(auth, /localStorage\.setItem\(['"]auth_user['"],\s*JSON\.stringify\(data\.data\)\)/)
  })

  it('shows both permission grants only to super administrators', () => {
    const page = readSource('src/pages/UserManagementPage.tsx')

    assert.match(page, /MATERIALS_EXTERNAL_READ\s*=\s*['"]materials:external:read['"]/)
    assert.match(page, /MATERIALS_EXTERNAL_MANAGE\s*=\s*['"]materials:external:manage['"]/)
    assert.match(page, /查看外部优质素材/)
    assert.match(page, /管理外部素材同步/)
    assert.match(page, /\{isSuperAdmin && \([\s\S]*查看外部优质素材[\s\S]*管理外部素材同步/)
  })

  it('makes manage imply read and sends only allowlisted permission strings', () => {
    const page = readSource('src/pages/UserManagementPage.tsx')

    assert.match(page, /sanitizeExternalPermissions/)
    assert.match(page, /MATERIALS_EXTERNAL_MANAGE[\s\S]*MATERIALS_EXTERNAL_READ/)
    assert.match(page, /permissions:\s*sanitizeExternalPermissions/)
    assert.match(page, /if\s*\(isSuperAdmin\)[\s\S]*updatePayload\.permissions/)
    assert.doesNotMatch(
      page,
      /if\s*\(!isSuperAdmin[\s\S]{0,220}updatePayload\.permissions/,
    )
  })
})
