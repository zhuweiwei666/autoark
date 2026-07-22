import Material from '../src/models/Material'
import {
  buildActiveShaQuery,
  buildMaterialFingerprintKey,
} from '../src/utils/materialContentIdentity'

describe('material content identity', () => {
  it('treats missing and explicit-null organization IDs as the same global scope', () => {
    const missingKey = buildMaterialFingerprintKey(undefined, 'shared-sha')
    const nullOrganizationId = null as unknown as undefined

    expect(missingKey).toMatch(/^content:[a-f0-9]{16}:sha256:shared-sha$/)
    expect(buildMaterialFingerprintKey(nullOrganizationId, 'shared-sha')).toBe(missingKey)
    expect(buildActiveShaQuery(undefined, 'shared-sha')).toEqual({
      organizationId: { $in: [null] },
      status: { $in: ['uploaded', 'ready'] },
      'fingerprint.sha256': 'shared-sha',
    })
    expect(buildActiveShaQuery(nullOrganizationId, 'shared-sha')).toEqual(
      buildActiveShaQuery(undefined, 'shared-sha'),
    )
  })

  it('keeps organization-private content identities isolated', () => {
    const firstKey = buildMaterialFingerprintKey('organization-a', 'shared-sha')
    const secondKey = buildMaterialFingerprintKey('organization-b', 'shared-sha')

    expect(firstKey).toMatch(/^content:[a-f0-9]{16}:sha256:shared-sha$/)
    expect(secondKey).toMatch(/^content:[a-f0-9]{16}:sha256:shared-sha$/)
    expect(firstKey).not.toBe(secondKey)
    expect(buildActiveShaQuery('organization-a', 'shared-sha')).toEqual({
      organizationId: 'organization-a',
      status: { $in: ['uploaded', 'ready'] },
      'fingerprint.sha256': 'shared-sha',
    })
  })

  it('indexes active SHA lookup by organization, hash, and status', () => {
    const hasActiveShaIndex = Material.schema.indexes().some(([fields]) =>
      fields.organizationId === 1
      && fields['fingerprint.sha256'] === 1
      && fields.status === 1)

    expect(hasActiveShaIndex).toBe(true)
  })
})
