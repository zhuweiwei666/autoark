export type GuangdadaSortBy = 'recent' | 'heat' | 'estimated_value'

export interface GuangdadaRawMedia {
  id?: string | number
  media_id?: string | number
  video_id?: string | number
  image_id?: string | number
  asset_id?: string | number
  url?: string
  video_url?: string
  image_url?: string
  download_url?: string
  play_url?: string
  source?: string
  src?: string
  role?: string
  media_role?: string
  heat?: string | number
  estimated_value?: string | number
  [key: string]: unknown
}

export type GuangdadaRawMediaValue = GuangdadaRawMedia | string

export interface GuangdadaAdRecord {
  id?: string | number
  ad_id?: string | number
  adId?: string | number
  creative_id?: string | number
  creativeId?: string | number
  record_id?: string | number
  package_id?: string | number
  packageId?: string | number
  package_name?: string
  packageName?: string
  product_name?: string
  productName?: string
  advertiser_name?: string
  advertiserName?: string
  source_page_url?: string
  sourcePageUrl?: string
  detail_url?: string
  ad_url?: string
  heat?: string | number
  estimated_value?: string | number
  estimatedValue?: string | number
  videos?: GuangdadaRawMediaValue[]
  images?: GuangdadaRawMediaValue[]
  [key: string]: unknown
}

export interface GuangdadaPagination {
  page?: number
  page_size?: number
  total?: number
  total_pages?: number
  has_more?: boolean
  [key: string]: unknown
}

export interface GuangdadaAdsPage {
  data: GuangdadaAdRecord[]
  pagination: GuangdadaPagination
}

export interface GuangdadaFetchOptions {
  page?: number
  pageSize?: number
  recentDays?: number
  sortBy?: GuangdadaSortBy
  packageName?: string
  fetchImpl?: typeof fetch
}

export interface GuangdadaFetchAllOptions extends GuangdadaFetchOptions {
  maxItems?: number
}

export type GuangdadaErrorCategory =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'server'
  | 'request'
  | 'network'
  | 'response'

export interface NormalizedGuangdadaAsset {
  provider: 'guangdada'
  providerAssetKey: string
  recordId?: string
  packageKey: string
  packageName?: string
  productName?: string
  advertiserName?: string
  mediaType: 'image' | 'video'
  mediaRole: string
  mediaIndex: number
  mediaUrl: string
  heat?: number
  estimatedValue?: number
  sourcePageUrl?: string
}
