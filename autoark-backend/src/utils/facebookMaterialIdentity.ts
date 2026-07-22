import { createHash } from 'crypto'

const ownerScope = (organizationId?: string) => organizationId
  ? `organization:${organizationId}`
  : 'facebook:global'

export const getFacebookMaterialOwnerHash = (organizationId?: string): string =>
  createHash('sha256').update(ownerScope(organizationId)).digest('hex').slice(0, 16)

export const buildFacebookMaterialFingerprintKey = (
  organizationId: string | undefined,
  sha256: string,
): string => `fb:${getFacebookMaterialOwnerHash(organizationId)}:sha256:${sha256}`

export const buildFacebookMaterialStorageFolder = (organizationId?: string): string =>
  `tenants/${getFacebookMaterialOwnerHash(organizationId)}/facebook-imports`
