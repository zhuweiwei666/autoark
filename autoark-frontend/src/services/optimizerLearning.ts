import { API_BASE_URL, authFetch } from "./api";

export interface OptimizerSummary {
  scopeKey: string;
  organizationId?: string;
  optimizerId: string;
  displayName: string;
  accountCount: number;
  activeAccounts: number;
  latestSourceSyncedAt?: string;
  latestPlaybookId?: string;
  lastGeneratedAt?: string;
  versionCount: number;
  lastEligibility?: {
    eligible: boolean;
    blockers: string[];
    warnings: string[];
  };
  accounts: Array<{
    accountId: string;
    name?: string;
    status?: string;
    currency?: string;
    sourceSyncedAt?: string;
  }>;
}

export interface RankedPerformance {
  key: string;
  dimension?: Record<string, string>;
  spend: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number | null;
  activeDays: number;
  confidence: number;
  score: number;
}

export interface OptimizerPlaybook {
  _id: string;
  organizationId?: string;
  optimizerId: string;
  version: number;
  status: "ready" | "blocked";
  generatedAt: string;
  source: {
    window: { since: string; until: string };
    accountIds: string[];
    currencies?: string[];
    sourceSyncedAt?: string;
    liveCollectedAt?: string;
  };
  coverage: {
    storedBreakdownRows: number;
    countries: number;
    placements: number;
    hours: number;
    materials: number;
    live?: Record<string, any>;
  };
  eligibility: {
    eligible: boolean;
    blockers: string[];
    warnings: string[];
    thresholds: Record<string, number>;
  };
  confidence: {
    score: number;
    level: "high" | "medium" | "low";
  };
  baseline: RankedPerformance;
  structure: {
    sourceCampaignName?: string;
    objective: string;
    budgetOptimization: boolean;
    observedDailyBudget: number;
    currency?: string;
    adsetsPerCampaign: number;
    adsPerAdset: number;
    optimizationGoal: string;
    billingEvent: string;
  };
  geography: RankedPerformance[];
  placements: RankedPerformance[];
  hours: RankedPerformance[];
  creatives: {
    materials: Array<{
      materialId: string;
      name: string;
      type: "image" | "video";
      url: string;
      thumbnailUrl?: string;
      performance: RankedPerformance;
    }>;
  };
  copywriting: {
    primaryTexts: string[];
    headlines: string[];
    descriptions: string[];
    websiteUrl: string;
    callToAction: string;
  };
  guardrails: {
    approvalRequired: boolean;
    campaignStatus: "PAUSED";
    adsetStatus: "PAUSED";
    adStatus: "PAUSED";
    suggestedPilotDailyBudget: number;
    maximumPilotDailyBudget: number;
    automaticActivationAllowed: false;
    automaticScalingAllowed: false;
  };
}

export interface PlaybookGeneration {
  _id: string;
  organizationId?: string;
  optimizerId: string;
  status: "queued" | "running" | "completed" | "failed";
  windowDays: number;
  refreshInsights: boolean;
  playbookId?: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ReplicaAssetAccount {
  accountId: string;
  name?: string;
  status?: number;
  currency?: string;
  timezone?: string;
  pages: Array<{ pageId: string; name?: string }>;
  pixels: Array<{ pixelId: string; name?: string }>;
}

export interface ReplicaAssetToken {
  tokenId: string;
  optimizer?: string;
  fbUserName?: string;
  syncStatus?: string;
  lastSyncedAt?: string;
  accounts: ReplicaAssetAccount[];
}

export interface ReplicaRun {
  _id: string;
  organizationId?: string;
  optimizerId: string;
  playbookVersionId: string;
  playbookVersion: number;
  status: string;
  effectiveStatus?: string;
  targets: {
    facebookTokenId: string;
    accountIds: string[];
    dailyBudget: number;
    currency?: string;
  };
  validation?: {
    isValid: boolean;
    errors: Array<{ field: string; message: string }>;
    warnings: Array<{ field: string; message: string }>;
  };
  aiChanges?: string[];
  draftId?: string;
  taskId?: string;
  blockedReasons?: string[];
  error?: string;
  evaluation?: any;
  createdAt: string;
  task?: {
    _id: string;
    status: string;
    progress?: Record<string, number>;
  };
}

const requestJson = async <T>(
  path: string,
  options: Parameters<typeof authFetch>[1] = {},
): Promise<T> => {
  const response = await authFetch(`${API_BASE_URL}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error: any = new Error(payload.message || "请求失败");
    error.details = payload.details;
    throw error;
  }
  return payload.data as T;
};

export const getOptimizers = (organizationId?: string) => {
  const query = organizationId
    ? `?organizationId=${encodeURIComponent(organizationId)}`
    : "";
  return requestJson<OptimizerSummary[]>(
    `/api/optimizer-learning/optimizers${query}`,
  );
};

export const generatePlaybook = (
  optimizerId: string,
  input: {
    organizationId?: string;
    windowDays?: number;
    refreshInsights?: boolean;
  },
) =>
  requestJson<{ generation: PlaybookGeneration; reused: boolean }>(
    `/api/optimizer-learning/optimizers/${encodeURIComponent(optimizerId)}/playbooks`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );

export const getPlaybookGeneration = (id: string) =>
  requestJson<PlaybookGeneration>(
    `/api/optimizer-learning/playbook-generations/${encodeURIComponent(id)}`,
  );

export const getPlaybooks = (
  input: {
    optimizerId?: string;
    organizationId?: string;
    limit?: number;
  } = {},
) => {
  const params = new URLSearchParams();
  if (input.optimizerId) params.set("optimizerId", input.optimizerId);
  if (input.organizationId) params.set("organizationId", input.organizationId);
  if (input.limit) params.set("limit", String(input.limit));
  const query = params.toString();
  return requestJson<OptimizerPlaybook[]>(
    `/api/optimizer-learning/playbooks${query ? `?${query}` : ""}`,
  );
};

export const getPlaybookById = (id: string) =>
  requestJson<OptimizerPlaybook>(
    `/api/optimizer-learning/playbooks/${encodeURIComponent(id)}`,
  );

export const getReplicaAssets = (playbookId: string) =>
  requestJson<{
    playbookId: string;
    organizationId?: string;
    tokens: ReplicaAssetToken[];
  }>(
    `/api/optimizer-learning/replica-assets?playbookId=${encodeURIComponent(playbookId)}`,
  );

export const createReplica = (
  playbookId: string,
  input: {
    facebookTokenId: string;
    accounts: Array<{
      accountId: string;
      accountName?: string;
      pageId?: string;
      pixelId?: string;
      conversionEvent?: string;
    }>;
    dailyBudget?: number;
    materialLimit?: number;
    applyTopCountries?: boolean;
    countryLimit?: number;
  },
) =>
  requestJson<{
    run: ReplicaRun;
    validation: ReplicaRun["validation"];
    requiredConfirmations: { approve: string; publish: string };
  }>(
    `/api/optimizer-learning/playbooks/${encodeURIComponent(playbookId)}/replicas`,
    {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 2 * 60 * 1000,
    },
  );

export const getReplicas = () =>
  requestJson<ReplicaRun[]>("/api/optimizer-learning/replicas?limit=100");

export const approveReplica = (id: string, note?: string) =>
  requestJson<ReplicaRun>(
    `/api/optimizer-learning/replicas/${encodeURIComponent(id)}/approve`,
    {
      method: "POST",
      body: JSON.stringify({ confirmation: "APPROVE_PAUSED_REPLICA", note }),
    },
  );

export const publishReplica = (id: string) =>
  requestJson<ReplicaRun>(
    `/api/optimizer-learning/replicas/${encodeURIComponent(id)}/publish`,
    {
      method: "POST",
      body: JSON.stringify({ confirmation: "PUBLISH_PAUSED_REPLICA" }),
      timeoutMs: 2 * 60 * 1000,
    },
  );

export const evaluateReplica = (id: string) =>
  requestJson<{
    run: ReplicaRun;
    evaluation: any;
  }>(`/api/optimizer-learning/replicas/${encodeURIComponent(id)}/evaluate`, {
    method: "POST",
  });
