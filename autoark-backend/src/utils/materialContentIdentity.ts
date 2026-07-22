import { createHash } from 'crypto'

export const buildMaterialFingerprintKey = (
  organizationId: string | undefined,
  sha256: string,
): string => {
  const scope = organizationId ? `organization:${organizationId}` : 'global'
  const scopeHash = createHash('sha256').update(scope).digest('hex').slice(0, 16)
  return `content:${scopeHash}:sha256:${sha256}`
}

export const buildActiveShaQuery = (
  organizationId: string | undefined,
  sha256: string,
) => ({
  organizationId: organizationId || { $in: [null] },
  status: { $in: ['uploaded', 'ready'] },
  'fingerprint.sha256': sha256,
})
