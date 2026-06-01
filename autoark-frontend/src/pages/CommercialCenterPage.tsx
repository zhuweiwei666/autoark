import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  FolderOpen,
  Lightning,
  ShieldCheck,
  Stack,
  UsersThree,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { getCommercialReadiness, type CommercialReadiness } from "../services/api";

const statusCopy: Record<string, { label: string; className: string; icon: any }> = {
  done: {
    label: "已就绪",
    className: "bg-[#e7f3ef] text-[#0f766e] border-[#b7e3d5]",
    icon: CheckCircle,
  },
  warning: {
    label: "需关注",
    className: "bg-[#fff7ed] text-[#b45309] border-[#fed7aa]",
    icon: WarningCircle,
  },
  pending: {
    label: "待完成",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
    icon: Clock,
  },
  blocked: {
    label: "阻塞",
    className: "bg-[#fff1f2] text-[#b4233a] border-[#fecdd3]",
    icon: XCircle,
  },
};

const riskTone: Record<string, string> = {
  critical: "border-[#fecdd3] bg-[#fff1f2] text-[#9f1239]",
  warning: "border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]",
  info: "border-zinc-200 bg-white text-zinc-700",
};

const stateTone: Record<string, { panel: string; badge: string; icon: any }> = {
  blocked: {
    panel: "border-[#fecdd3] bg-[#fff8f8] text-[#9f1239]",
    badge: "bg-[#fff1f2] text-[#9f1239] border-[#fecdd3]",
    icon: XCircle,
  },
  attention: {
    panel: "border-[#fed7aa] bg-[#fffaf3] text-[#9a3412]",
    badge: "bg-[#fff7ed] text-[#9a3412] border-[#fed7aa]",
    icon: WarningCircle,
  },
  ready: {
    panel: "border-[#b7e3d5] bg-[#f4fbf8] text-[#0f766e]",
    badge: "bg-[#e7f3ef] text-[#0f766e] border-[#b7e3d5]",
    icon: CheckCircle,
  },
};

const priorityTone: Record<string, string> = {
  critical: "bg-[#fff1f2] text-[#9f1239] border-[#fecdd3]",
  high: "bg-[#fff7ed] text-[#9a3412] border-[#fed7aa]",
  medium: "bg-[#f8fafc] text-zinc-700 border-zinc-200",
  low: "bg-[#f4fbf8] text-[#0f766e] border-[#b7e3d5]",
};

const priorityLabels: Record<string, string> = {
  critical: "必须处理",
  high: "优先处理",
  medium: "上线前处理",
  low: "建议完善",
};

const sourceLabels: Record<string, string> = {
  setup: "系统配置",
  facebook: "Facebook 资产",
  quota: "套餐额度",
  tasks: "任务闭环",
  team: "团队权限",
  materials: "素材准备",
};

const metricLabels: Record<string, string> = {
  members: "成员",
  adAccounts: "广告账户",
  materials: "素材",
  monthlyTasks: "本月任务",
  concurrentTasks: "当前并发",
};

const featureLabels: Record<string, string> = {
  facebook_oauth: "Facebook 授权",
  bulk_ad_create: "批量建广告",
  material_library: "素材库",
  asset_sync: "资产同步",
  review_tracking: "审核追踪",
  automation_agent: "投放 Agent",
  team_management: "团队管理",
  audit_ready: "审计就绪",
};

function ReadinessGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#0f766e" : score >= 55 ? "#b45309" : "#b4233a";
  return (
    <div className="relative flex h-36 w-36 items-center justify-center rounded-full bg-white shadow-[0_18px_42px_-32px_rgba(24,24,27,0.75)]">
      <svg viewBox="0 0 120 120" className="absolute h-full w-full -rotate-90">
        <circle cx="60" cy="60" r="50" fill="none" stroke="#e7e5e4" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth="10"
          strokeDasharray={`${Math.max(0, Math.min(score, 100)) * 3.14} 314`}
        />
      </svg>
      <div className="relative text-center">
        <div className="font-mono text-4xl font-black text-zinc-950">{score}</div>
        <div className="mt-1 text-xs font-bold text-zinc-500">商用分</div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-zinc-500">{label}</div>
          <div className="mt-4 font-mono text-3xl font-black text-zinc-950">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf4f1] text-[#0f766e]">
          {icon}
        </div>
      </div>
      <div className="mt-4 text-sm font-bold text-zinc-600">{detail}</div>
    </article>
  );
}

function UsageBar({
  label,
  used,
  limit,
  percent,
  status,
}: {
  label: string;
  used: number;
  limit: number | null;
  percent: number | null;
  status: string;
}) {
  const width = limit ? Math.min(percent || 0, 100) : 100;
  const barClass =
    status === "exceeded"
      ? "bg-[#b4233a]"
      : status === "warning"
        ? "bg-[#b45309]"
        : "bg-zinc-950";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="font-bold text-zinc-800">{label}</span>
        <span className="font-mono text-xs font-bold text-zinc-500">
          {used} / {limit || "不限"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function ChecklistRow({ item }: { item: CommercialReadiness["checklist"][number] }) {
  const tone = statusCopy[item.status] || statusCopy.pending;
  const Icon = tone.icon;

  return (
    <div className="flex items-start gap-4 border-b border-zinc-100 py-4 last:border-b-0">
      <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${tone.className}`}>
        <Icon size={18} weight="fill" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-extrabold text-zinc-950">{item.title}</h3>
          <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${tone.className}`}>
            {tone.label}
          </span>
          {item.metric && (
            <span className="font-mono text-xs font-bold text-zinc-500">{item.metric}</span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium leading-6 text-zinc-600">{item.description}</p>
      </div>
      {item.actionPath && (
        <Link
          to={item.actionPath}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-900 hover:border-zinc-400 md:inline-flex"
        >
          处理
          <ArrowRight size={14} weight="bold" />
        </Link>
      )}
    </div>
  );
}

function NextActionCard({ action }: { action: CommercialReadiness["nextActions"][number] }) {
  return (
    <article className="flex h-full flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-black ${priorityTone[action.priority] || priorityTone.medium}`}>
            {priorityLabels[action.priority] || action.priority}
          </span>
          <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-600">
            {sourceLabels[action.source] || action.source}
          </span>
        </div>
        <h3 className="mt-3 text-base font-black leading-6 text-zinc-950">{action.title}</h3>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-600">{action.description}</p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
        <span className="text-xs font-bold text-zinc-500">{action.owner}</span>
        {action.actionPath && (
          <Link
            to={action.actionPath}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-900 hover:border-zinc-400"
          >
            去处理
            <ArrowRight size={14} weight="bold" />
          </Link>
        )}
      </div>
    </article>
  );
}

export default function CommercialCenterPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["commercial-readiness"],
    queryFn: () => getCommercialReadiness(),
  });

  const readiness = data?.data;
  const readinessState = readiness?.state || {
    level: "attention",
    label: "状态计算中",
    summary: "正在同步商用验收状态。",
  };
  const readinessTone = stateTone[readinessState.level] || stateTone.attention;
  const ReadinessStateIcon = readinessTone.icon;
  const nextActions = readiness?.nextActions || [];
  const topMetrics = useMemo(() => {
    if (!readiness) return [];
    return [
      {
        label: "广告账户",
        value: String(readiness.metrics.adAccounts || 0),
        detail: `${readiness.metrics.activeTokens || 0} 授权 · ${readiness.metrics.facebookReadyAccounts || 0} 就绪`,
        icon: <Stack size={22} weight="fill" />,
      },
      {
        label: "素材资产",
        value: String(readiness.metrics.materials || 0),
        detail: "可用于批量投放",
        icon: <FolderOpen size={22} weight="fill" />,
      },
      {
        label: "任务闭环",
        value: String(readiness.metrics.successfulTasks || 0),
        detail: `${readiness.metrics.tasks || 0} 个总任务`,
        icon: <Lightning size={22} weight="fill" />,
      },
      {
        label: "团队成员",
        value: String(readiness.metrics.members || 0),
        detail: readiness.scope.mode === "platform" ? "全平台用户" : readiness.plan.billingStatus,
        icon: <UsersThree size={22} weight="fill" />,
      },
    ];
  }, [readiness]);

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-7xl items-center justify-center px-6">
        <div className="text-sm font-bold text-zinc-500">正在加载商用状态...</div>
      </div>
    );
  }

  if (error || !readiness) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="rounded-lg border border-[#fecdd3] bg-[#fff1f2] p-5 text-sm font-bold text-[#9f1239]">
          获取商用状态失败：{(error as Error)?.message || "未知错误"}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg border border-[#b7e3d5] bg-[#e7f3ef] px-3 py-1 text-xs font-black text-[#0f766e]">
              <ShieldCheck size={15} weight="fill" />
              SaaS Readiness
            </span>
            <span className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-zinc-500">
              {readiness.scope.organizationName}
            </span>
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-normal text-zinc-950 sm:text-4xl">
            商用中心
          </h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-zinc-600">
            汇总组织套餐、额度、Facebook 授权、广告账户、素材和任务闭环状态，作为客户交付前的统一验收入口。
          </p>
          <div className={`mt-5 max-w-4xl rounded-lg border p-4 ${readinessTone.panel}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${readinessTone.badge}`}>
                  <ReadinessStateIcon size={18} weight="fill" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md border px-2 py-0.5 text-xs font-black ${readinessTone.badge}`}>
                      {readinessState.label}
                    </span>
                    <span className="text-xs font-bold text-zinc-500">当前商用状态</span>
                  </div>
                  <p className="mt-2 text-sm font-bold leading-6">{readinessState.summary}</p>
                </div>
              </div>
              {nextActions[0]?.actionPath && (
                <Link
                  to={nextActions[0].actionPath}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-black text-white hover:bg-zinc-800"
                >
                  先处理：{nextActions[0].title}
                  <ArrowRight size={15} weight="bold" />
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="lg:justify-self-end">
          <ReadinessGauge score={readiness.score} />
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {topMetrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      {nextActions.length > 0 && (
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-zinc-950">优先处理</h2>
              <p className="mt-1 text-sm font-semibold text-zinc-500">
                按顺序处理这些动作，处理后刷新商用状态即可验收。
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:border-zinc-400 disabled:opacity-60"
            >
              {isFetching ? "刷新中" : "刷新状态"}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {nextActions.slice(0, 6).map((action) => (
              <NextActionCard key={action.id} action={action} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h2 className="text-lg font-black text-zinc-950">商用验收清单</h2>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-700 hover:border-zinc-400 disabled:opacity-60"
            >
              {isFetching ? "刷新中" : "刷新"}
            </button>
          </div>
          <div>
            {readiness.checklist.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-zinc-950">套餐与额度</h2>
                <p className="mt-1 text-sm font-bold text-zinc-500">{readiness.plan.label}</p>
              </div>
              <span className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-black text-zinc-700">
                {readiness.plan.code}
              </span>
            </div>
            <div className="mt-5 space-y-4">
              {Object.entries(readiness.usage).map(([key, value]) => (
                <UsageBar
                  key={key}
                  label={metricLabels[key] || key}
                  used={value.used}
                  limit={value.limit}
                  percent={value.percent}
                  status={value.status}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
            <h2 className="text-lg font-black text-zinc-950">已开通能力</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {readiness.plan.features.map((feature) => (
                <span
                  key={feature}
                  className="rounded-lg border border-zinc-200 bg-[#fbfbf8] px-3 py-1.5 text-xs font-bold text-zinc-700"
                >
                  {featureLabels[feature] || feature}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
            <h2 className="text-lg font-black text-zinc-950">上线保护</h2>
            <div className="mt-4 space-y-2 text-sm font-bold text-zinc-700">
              {Object.entries(readiness.deployment).map(([key, enabled]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span>{key}</span>
                  <span className={enabled ? "text-[#0f766e]" : "text-[#b45309]"}>
                    {enabled ? "已配置" : "待配置"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </section>

      {readiness.risks.length > 0 && (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
          <h2 className="text-lg font-black text-zinc-950">风险与下一步</h2>
          <div className="mt-4 grid gap-3">
            {readiness.risks.map((risk, index) => (
              <div
                key={`${risk.message}-${index}`}
                className={`flex items-start justify-between gap-4 rounded-lg border p-4 text-sm font-bold ${riskTone[risk.level] || riskTone.info}`}
              >
                <span>{risk.message}</span>
                {risk.actionPath && (
                  <Link to={risk.actionPath} className="shrink-0 underline underline-offset-4">
                    去处理
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
