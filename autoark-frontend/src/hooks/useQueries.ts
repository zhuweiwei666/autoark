import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getAccounts,
  getCampaigns,
  getCountries,
  getTokens,
  getPixels,
  getMaterialRankings,
  getCoreMetrics,
  getSpendTrend,
  getCampaignRanking,
  getAccountRanking,
} from '../services/api'

// ==================== Query Keys ====================
// 集中管理所有 query keys，便于缓存失效和预加载

export const queryKeys = {
  // 账户相关
  accounts: (params?: any) => ['accounts', params] as const,
  
  // 广告系列相关
  campaigns: (params?: any) => ['campaigns', params] as const,
  
  // 国家相关
  countries: (params?: any) => ['countries', params] as const,
  
  // Token 相关
  tokens: (params?: any) => ['tokens', params] as const,
  
  // Pixel 相关
  pixels: (params?: any) => ['pixels', params] as const,
  
  // 素材相关
  materialRankings: (params?: any) => ['materialRankings', params] as const,
  
  // Dashboard 相关
  coreMetrics: (startDate?: string, endDate?: string) => ['coreMetrics', startDate, endDate] as const,
  spendTrend: (startDate?: string, endDate?: string) => ['spendTrend', startDate, endDate] as const,
  campaignRanking: (limit?: number, startDate?: string, endDate?: string) => ['campaignRanking', limit, startDate, endDate] as const,
  accountRanking: (limit?: number, startDate?: string, endDate?: string) => ['accountRanking', limit, startDate, endDate] as const,
}

// ==================== Custom Hooks ====================

/**
 * 获取账户列表
 */
export function useAccounts(params?: Parameters<typeof getAccounts>[0]) {
  return useQuery({
    queryKey: queryKeys.accounts(params),
    queryFn: () => getAccounts(params),
    staleTime: 1000 * 60 * 2, // 2分钟
  })
}

/**
 * 获取广告系列列表
 */
export function useCampaigns(params?: Parameters<typeof getCampaigns>[0]) {
  return useQuery({
    queryKey: queryKeys.campaigns(params),
    queryFn: () => getCampaigns(params),
    staleTime: 1000 * 60 * 2,
  })
}

/**
 * 获取国家数据
 */
export function useCountries(params?: Parameters<typeof getCountries>[0]) {
  return useQuery({
    queryKey: queryKeys.countries(params),
    queryFn: () => getCountries(params),
    staleTime: 1000 * 60 * 2,
  })
}

/**
 * 获取 Token 列表
 */
export function useTokens(params?: Parameters<typeof getTokens>[0]) {
  return useQuery({
    queryKey: queryKeys.tokens(params),
    queryFn: () => getTokens(params),
    staleTime: 1000 * 60 * 5, // Token 变化少，缓存 5 分钟
  })
}

/**
 * 获取 Pixel 列表
 */
export function usePixels(params?: Parameters<typeof getPixels>[0]) {
  return useQuery({
    queryKey: queryKeys.pixels(params),
    queryFn: () => getPixels(params),
    staleTime: 1000 * 60 * 5,
  })
}

/**
 * 获取素材排行榜
 */
export function useMaterialRankings(params?: Parameters<typeof getMaterialRankings>[0]) {
  return useQuery({
    queryKey: queryKeys.materialRankings(params),
    queryFn: () => getMaterialRankings(params),
    staleTime: 1000 * 60 * 2,
  })
}

/**
 * 获取核心指标 (Dashboard)
 */
export function useCoreMetrics(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: queryKeys.coreMetrics(startDate, endDate),
    queryFn: () => getCoreMetrics(startDate, endDate),
    staleTime: 1000 * 60 * 1, // 1分钟，实时数据更新快
  })
}

/**
 * 获取消耗趋势 (Dashboard)
 */
export function useSpendTrend(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: queryKeys.spendTrend(startDate, endDate),
    queryFn: () => getSpendTrend(startDate, endDate),
    staleTime: 1000 * 60 * 1,
  })
}

/**
 * 获取广告系列排行 (Dashboard)
 */
export function useCampaignRanking(limit = 10, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: queryKeys.campaignRanking(limit, startDate, endDate),
    queryFn: () => getCampaignRanking(limit, startDate, endDate),
    staleTime: 1000 * 60 * 1,
  })
}

/**
 * 获取账户排行 (Dashboard)
 */
export function useAccountRanking(limit = 10, startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: queryKeys.accountRanking(limit, startDate, endDate),
    queryFn: () => getAccountRanking(limit, startDate, endDate),
    staleTime: 1000 * 60 * 1,
  })
}

// ==================== Prefetch Hooks ====================

/**
 * 预加载 Hook - 用于导航 hover 时预加载数据
 */
export function usePrefetch() {
  const queryClient = useQueryClient()
  
  const prefetchAccounts = (params?: Parameters<typeof getAccounts>[0]) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.accounts(params),
      queryFn: () => getAccounts(params),
      staleTime: 1000 * 60 * 2,
    })
  }
  
  const prefetchCampaigns = (params?: Parameters<typeof getCampaigns>[0]) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.campaigns(params),
      queryFn: () => getCampaigns(params),
      staleTime: 1000 * 60 * 2,
    })
  }
  
  const prefetchCountries = (params?: Parameters<typeof getCountries>[0]) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.countries(params),
      queryFn: () => getCountries(params),
      staleTime: 1000 * 60 * 2,
    })
  }
  
  const prefetchTokens = (params?: Parameters<typeof getTokens>[0]) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.tokens(params),
      queryFn: () => getTokens(params),
      staleTime: 1000 * 60 * 5,
    })
  }
  
  const prefetchPixels = (params?: Parameters<typeof getPixels>[0]) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.pixels(params),
      queryFn: () => getPixels(params),
      staleTime: 1000 * 60 * 5,
    })
  }
  
  const prefetchMaterialRankings = (params?: Parameters<typeof getMaterialRankings>[0]) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.materialRankings(params),
      queryFn: () => getMaterialRankings(params),
      staleTime: 1000 * 60 * 2,
    })
  }
  
  return {
    prefetchAccounts,
    prefetchCampaigns,
    prefetchCountries,
    prefetchTokens,
    prefetchPixels,
    prefetchMaterialRankings,
  }
}

// ==================== Cache Invalidation ====================

/**
 * 缓存失效 Hook - 用于同步数据后刷新缓存
 */
export function useInvalidateQueries() {
  const queryClient = useQueryClient()
  
  const invalidateAccounts = () => {
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }
  
  const invalidateCampaigns = () => {
    queryClient.invalidateQueries({ queryKey: ['campaigns'] })
  }
  
  const invalidateCountries = () => {
    queryClient.invalidateQueries({ queryKey: ['countries'] })
  }
  
  const invalidateTokens = () => {
    queryClient.invalidateQueries({ queryKey: ['tokens'] })
  }
  
  const invalidatePixels = () => {
    queryClient.invalidateQueries({ queryKey: ['pixels'] })
  }
  
  const invalidateMaterialRankings = () => {
    queryClient.invalidateQueries({ queryKey: ['materialRankings'] })
  }
  
  const invalidateDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ['coreMetrics'] })
    queryClient.invalidateQueries({ queryKey: ['spendTrend'] })
    queryClient.invalidateQueries({ queryKey: ['campaignRanking'] })
    queryClient.invalidateQueries({ queryKey: ['accountRanking'] })
  }
  
  const invalidateAll = () => {
    queryClient.invalidateQueries()
  }
  
  return {
    invalidateAccounts,
    invalidateCampaigns,
    invalidateCountries,
    invalidateTokens,
    invalidatePixels,
    invalidateMaterialRankings,
    invalidateDashboard,
    invalidateAll,
  }
}

