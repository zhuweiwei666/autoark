const OPERATIONAL_SUFFIXES = new Set(['autoark', 'ios', 'android'])
const GENERIC_ASSET_NAMES = new Set([
  ...OPERATIONAL_SUFFIXES,
  'pixel',
  'web',
  'app',
  'meta',
  'facebook',
  'fb',
])

export interface ProductAssetNameIdentity {
  key: string
  displayName: string
  tokens: string[]
}

const tokenize = (value: unknown): string[] => {
  if (typeof value !== 'string') return []
  const normalized = value
    .normalize('NFKC')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
  return normalized.match(/[\p{L}\p{N}]+/gu) || []
}

/**
 * Extracts the stable product-name prefix used by AutoArk asset naming.
 *
 * Examples:
 * - Leyon-autoark -> leyon
 * - Leyon-ios-autoark -> leyon
 * - Cling AI-android-autoark -> cling ai
 *
 * Only known operational suffixes are removed, and at least one meaningful
 * token must remain. This intentionally avoids fuzzy matching.
 */
export const parseProductAssetName = (
  value: unknown,
): ProductAssetNameIdentity | null => {
  const displayTokens = tokenize(value)
  const normalizedTokens = displayTokens.map((token) => token.toLowerCase())

  while (
    normalizedTokens.length > 1 &&
    OPERATIONAL_SUFFIXES.has(normalizedTokens[normalizedTokens.length - 1])
  ) {
    normalizedTokens.pop()
    displayTokens.pop()
  }

  if (
    normalizedTokens.length === 0 ||
    normalizedTokens.every((token) => GENERIC_ASSET_NAMES.has(token))
  ) {
    return null
  }

  return {
    key: normalizedTokens.join(' '),
    displayName: displayTokens.join(' '),
    tokens: normalizedTokens,
  }
}

export const hasExactProductAssetName = (
  left: unknown,
  right: unknown,
): boolean => {
  const leftIdentity = parseProductAssetName(left)
  const rightIdentity = parseProductAssetName(right)
  return Boolean(
    leftIdentity && rightIdentity && leftIdentity.key === rightIdentity.key,
  )
}

export const productIdentifierFromName = (value: unknown): string | null => {
  const identity = parseProductAssetName(value)
  if (!identity) return null
  return `name:${identity.key.replace(/\s+/g, '-').slice(0, 220)}`
}
