const jsonPlain = (value: any) => {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

const canonicalize = (value: any): any => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.keys(value)
    .sort()
    .reduce((result: Record<string, any>, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key])
      return result
    }, {})
}

export const frozenCreativeSnapshot = (creativeGroup: any) => ({
  format: creativeGroup?.config?.format || 'single',
  dynamicCreative: creativeGroup?.config?.dynamicCreative === true,
  materials: (creativeGroup?.materials || []).map((material: any) => ({
    type: material.type,
    url: material.url,
    name: material.name,
    width: material.width,
    height: material.height,
    duration: material.duration,
    size: material.size,
    format: material.format,
    thumbnail: material.thumbnail,
  })),
})

export const frozenCopywritingSnapshot = (copywritingPackage: any) => ({
  content: {
    primaryTexts: copywritingPackage?.content?.primaryTexts || [],
    headlines: copywritingPackage?.content?.headlines || [],
    descriptions: copywritingPackage?.content?.descriptions || [],
  },
  callToAction: copywritingPackage?.callToAction || 'SHOP_NOW',
  links: {
    websiteUrl: copywritingPackage?.links?.websiteUrl,
    displayLink: copywritingPackage?.links?.displayLink,
    deepLink: copywritingPackage?.links?.deepLink,
  },
  product: copywritingPackage?.product,
  urlParameters: copywritingPackage?.urlParameters,
  language: copywritingPackage?.language,
})

export const canonicalJson = (value: any) =>
  JSON.stringify(canonicalize(jsonPlain(value)))
