const ACCOUNT_SCOPED_TARGETING_KEYS = new Set([
  'custom_audiences',
  'excluded_custom_audiences',
  'saved_audience_id',
  'product_audience_specs',
  'dynamic_audience_ids',
  'connections',
  'excluded_connections',
  'friends_of_connections',
  'engagement_specs',
  'prospecting_project_id',
])

const isPlainObject = (value: any): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const sanitizeOptimizerTargeting = (
  targeting: any,
): {
  targeting: Record<string, any>
  removedKeys: string[]
} => {
  const removedKeys = new Set<string>()

  const visit = (value: any, path: string): any => {
    if (Array.isArray(value)) {
      return value.map((entry, index) => visit(entry, `${path}[${index}]`))
    }
    if (!isPlainObject(value)) return value

    const output: Record<string, any> = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = path ? `${path}.${key}` : key
      if (ACCOUNT_SCOPED_TARGETING_KEYS.has(key)) {
        removedKeys.add(nestedPath)
        continue
      }
      output[key] = visit(nestedValue, nestedPath)
    }
    return output
  }

  return {
    targeting: visit(targeting || {}, ''),
    removedKeys: Array.from(removedKeys).sort(),
  }
}
