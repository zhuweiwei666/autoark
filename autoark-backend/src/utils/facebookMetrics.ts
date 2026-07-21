export const parseFacebookPurchaseRoas = (value: unknown): number => {
  const candidates = Array.isArray(value)
    ? value.map((item) => item && typeof item === 'object' && 'value' in item
      ? (item as { value?: unknown }).value
      : item)
    : [value && typeof value === 'object' && 'value' in value
      ? (value as { value?: unknown }).value
      : value]

  for (const candidate of candidates) {
    const parsed = typeof candidate === 'number' ? candidate : Number(candidate)
    if (Number.isFinite(parsed)) return parsed
  }

  return 0
}
