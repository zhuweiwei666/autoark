export const PRODUCT_LINK_DEFAULT_DOMAIN = 'go.remixhub.app'

export const PRODUCT_LINK_DOMAIN_OPTIONS = [
  { hostname: PRODUCT_LINK_DEFAULT_DOMAIN, label: 'remixhub.app（推荐）' },
  { hostname: 'app.autoark.work', label: 'AutoArk 原域名' },
  { hostname: 'go.angelablog.com', label: 'angelablog.com' },
  { hostname: 'go.bigloom.net', label: 'bigloom.net' },
  { hostname: 'go.flendarealty.com', label: 'flendarealty.com' },
  { hostname: 'go.florencexo.com', label: 'florencexo.com' },
  { hostname: 'go.floxo.net', label: 'floxo.net' },
  { hostname: 'go.floxoclothing.com', label: 'floxoclothing.com' },
  { hostname: 'go.floxoclothingcom.com', label: 'floxoclothingcom.com' },
  { hostname: 'go.goodkawaii.com', label: 'goodkawaii.com' },
  { hostname: 'go.hexoru.com', label: 'hexoru.com' },
  { hostname: 'go.joyonline.cc', label: 'joyonline.cc' },
  { hostname: 'go.melafashion.net', label: 'melafashion.net' },
  { hostname: 'go.pujee.net', label: 'pujee.net' },
  { hostname: 'go.texdipco.com', label: 'texdipco.com' },
  { hostname: 'go.tran-dor.com', label: 'tran-dor.com' },
  { hostname: 'go.trandorcom.com', label: 'trandorcom.com' },
  { hostname: 'go.vibinbox.net', label: 'vibinbox.net' },
] as const

export const PRODUCT_LINK_DOMAIN_HOSTS = PRODUCT_LINK_DOMAIN_OPTIONS.map(
  (option) => option.hostname,
)

export type ProductLinkDomain =
  (typeof PRODUCT_LINK_DOMAIN_OPTIONS)[number]['hostname']

const PRODUCT_LINK_DOMAIN_SET = new Set<string>(PRODUCT_LINK_DOMAIN_HOSTS)

export const isProductLinkDomain = (
  value: string,
): value is ProductLinkDomain => PRODUCT_LINK_DOMAIN_SET.has(value)

export const resolveProductLinkDomain = (value: unknown): ProductLinkDomain => {
  const hostname = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isProductLinkDomain(hostname) ? hostname : PRODUCT_LINK_DEFAULT_DOMAIN
}
