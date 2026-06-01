import { OrganizationPlan } from '../models/Organization'

export const COMMERCIAL_FEATURES = [
  'facebook_oauth',
  'bulk_ad_create',
  'material_library',
  'asset_sync',
  'review_tracking',
  'automation_agent',
  'team_management',
  'audit_ready',
] as const

export const COMMERCIAL_FEATURE_SET = new Set<string>(COMMERCIAL_FEATURES)

export const PLAN_DEFAULTS: Record<OrganizationPlan, {
  label: string
  limits: {
    maxMembers: number | null
    maxAdAccounts: number | null
    maxMaterials: number | null
    maxConcurrentTasks: number | null
    monthlyTaskLimit: number | null
  }
  features: string[]
}> = {
  [OrganizationPlan.TRIAL]: {
    label: '试用版',
    limits: {
      maxMembers: 3,
      maxAdAccounts: 3,
      maxMaterials: 100,
      maxConcurrentTasks: 1,
      monthlyTaskLimit: 20,
    },
    features: ['facebook_oauth', 'bulk_ad_create', 'material_library', 'team_management'],
  },
  [OrganizationPlan.STARTER]: {
    label: '标准版',
    limits: {
      maxMembers: 10,
      maxAdAccounts: 15,
      maxMaterials: 1000,
      maxConcurrentTasks: 3,
      monthlyTaskLimit: 300,
    },
    features: ['facebook_oauth', 'bulk_ad_create', 'material_library', 'asset_sync', 'team_management'],
  },
  [OrganizationPlan.GROWTH]: {
    label: '增长版',
    limits: {
      maxMembers: 30,
      maxAdAccounts: 80,
      maxMaterials: 8000,
      maxConcurrentTasks: 8,
      monthlyTaskLimit: 3000,
    },
    features: [
      'facebook_oauth',
      'bulk_ad_create',
      'material_library',
      'asset_sync',
      'review_tracking',
      'automation_agent',
      'team_management',
      'audit_ready',
    ],
  },
  [OrganizationPlan.ENTERPRISE]: {
    label: '企业版',
    limits: {
      maxMembers: null,
      maxAdAccounts: null,
      maxMaterials: null,
      maxConcurrentTasks: null,
      monthlyTaskLimit: null,
    },
    features: [...COMMERCIAL_FEATURES],
  },
}
