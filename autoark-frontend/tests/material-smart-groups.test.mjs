import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const readSource = (relativePath) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

describe('material smart groups', () => {
  it('loads the role-filtered tree through a dedicated typed service', () => {
    const service = readSource('src/services/materialSmartGroups.ts')

    assert.match(service, /export interface MaterialSmartGroupNode/)
    assert.match(service, /export type MaterialSelection/)
    assert.match(service, /authFetch\(['"`]\s*\/api\/materials\/smart-groups/)
    assert.match(service, /smartGroupType/)
    assert.match(service, /smartGroupKey/)
  })

  it('uses smart-group query parameters instead of treating groups as folders', () => {
    const service = readSource('src/services/materialSmartGroups.ts')
    const page = readSource('src/pages/MaterialLibraryPage.tsx')

    assert.match(
      service,
      /selection\.kind === ['"]smart['"][\s\S]*smartGroupType[\s\S]*smartGroupKey/,
    )
    assert.match(
      service,
      /selection\.kind === ['"]folder['"][\s\S]*params\.set\(['"]folder['"]/,
    )
    assert.match(page, /useState<MaterialSelection>\(\{\s*kind:\s*['"]all['"]\s*\}\)/)
    assert.match(page, /setPage\(1\)/)
    assert.doesNotMatch(page, /if\s*\(currentPath\)\s*params\.append\(['"]folder['"]/)
  })

  it('renders read-only Facebook and external hierarchies with explicit states', () => {
    const page = readSource('src/pages/MaterialLibraryPage.tsx')

    assert.match(page, /loadMaterialSmartGroups/)
    assert.match(page, /Facebook/)
    assert.match(page, /外部优质素材/)
    assert.match(page, /只读/)
    assert.match(page, /已停用/)
    assert.match(page, /不可用/)
    assert.match(page, /同步已暂停/)
    assert.match(page, /智能分组加载中/)
    assert.match(page, /该智能分组暂无素材/)
    assert.match(page, /智能分组暂不可用/)
    assert.match(page, /selection\.kind === ['"]folder['"]/)
  })

  it('shows source and reuse cues and only loads restricted origins on demand', () => {
    const page = readSource('src/pages/MaterialLibraryPage.tsx')

    assert.match(page, /来源/)
    assert.match(page, /Facebook/)
    assert.match(page, /广大大/)
    assert.match(page, /关联账户/)
    assert.match(page, /产品\/包/)
    assert.match(page, /loadMaterialOrigins\(viewMaterial\._id\)/)
    assert.match(page, /status === 403/)
    assert.match(page, /无权查看来源详情/)
  })

  it('gates redacted status and bounded sync controls on manage permission', () => {
    const page = readSource('src/pages/MaterialLibraryPage.tsx')
    const service = readSource('src/services/materialSmartGroups.ts')

    assert.match(page, /materials:external:manage/)
    assert.match(page, /试运行/)
    assert.match(page, /立即同步/)
    assert.match(page, /暂停同步/)
    assert.match(page, /恢复同步/)
    assert.match(page, /confirm\(/)
    assert.match(service, /mode:\s*['"]scheduled['"]/)
    assert.match(service, /mode:\s*['"]canary10['"]/)
    assert.match(service, /\/api\/materials\/external\/guangdada\/status/)
    assert.match(service, /\/api\/materials\/external\/guangdada\/(sync|pause|resume)/)
  })
})
