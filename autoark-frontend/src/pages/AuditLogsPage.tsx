import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClockCounterClockwise, FunnelSimple, ShieldCheck } from "@phosphor-icons/react";
import { getAuditLogs, getOrganizations, type AuditLogEntry } from "../services/api";
import { useAuth } from "../contexts/AuthContext";

const categories = [
  { value: "", label: "全部类型" },
  { value: "auth", label: "登录安全" },
  { value: "user", label: "用户管理" },
  { value: "organization", label: "组织管理" },
  { value: "bulk_ad", label: "批量投放" },
  { value: "facebook_app", label: "Facebook App" },
  { value: "commercial", label: "商用中心" },
];

const statuses = [
  { value: "", label: "全部状态" },
  { value: "success", label: "成功" },
  { value: "failed", label: "失败" },
  { value: "warning", label: "警告" },
];

const actionOptions = [
  { value: "", label: "全部动作" },
  { value: "commercial.support_package.generate", label: "生成客户支持包" },
  { value: "bulk_ad.facebook_login_url", label: "生成 Facebook 授权链接" },
  { value: "bulk_ad.facebook_oauth_callback", label: "Facebook 授权回调" },
  { value: "bulk_ad.task_support_package.generate", label: "生成任务排障包" },
  { value: "bulk_ad.publish", label: "发布批量广告" },
  { value: "bulk_ad.retry", label: "重试失败任务" },
  { value: "bulk_ad.rerun", label: "重新执行任务" },
  { value: "bulk_ad.facebook_resync", label: "同步 Facebook 资产" },
  { value: "organization.update", label: "更新组织" },
  { value: "facebook_app.compliance_update", label: "更新 App 合规" },
];

const statusClass: Record<string, string> = {
  success: "bg-[#e7f3ef] text-[#0f766e] border-[#b7e3d5]",
  failed: "bg-[#fff1f2] text-[#b4233a] border-[#fecdd3]",
  warning: "bg-[#fff7ed] text-[#b45309] border-[#fed7aa]",
};

const actionLabel: Record<string, string> = {
  "auth.login": "登录",
  "auth.change_password": "修改密码",
  "user.create": "创建用户",
  "user.update": "更新用户",
  "user.delete": "删除用户",
  "user.update_status": "更新用户状态",
  "user.reset_password": "重置密码",
  "organization.create": "创建组织",
  "organization.update": "更新组织",
  "organization.delete": "删除组织",
  "organization.update_status": "更新组织状态",
  "bulk_ad.publish": "发布批量广告",
  "bulk_ad.cancel": "取消投放任务",
  "bulk_ad.retry": "重试失败任务",
  "bulk_ad.rerun": "重新执行任务",
  "bulk_ad.facebook_resync": "同步 Facebook 资产",
  "bulk_ad.facebook_login_url": "生成 Facebook 授权链接",
  "bulk_ad.facebook_oauth_callback": "Facebook 授权回调",
  "bulk_ad.task_support_package.generate": "生成任务排障包",
  "facebook_app.create": "创建 Facebook App",
  "facebook_app.update": "更新 Facebook App",
  "facebook_app.delete": "删除 Facebook App",
  "facebook_app.validate": "验证 Facebook App",
  "facebook_app.compliance_update": "更新 App 合规",
  "commercial.support_package.generate": "生成客户支持包",
};

const auditFieldLabels: Record<string, string> = {
  "name": "组织名称",
  "status": "组织状态",
  "billing.plan": "套餐",
  "billing.status": "账单状态",
  "settings.maxMembers": "成员上限",
  "settings.maxAdAccounts": "广告账户上限",
  "settings.maxMaterials": "素材上限",
  "settings.maxConcurrentTasks": "并发任务上限",
  "settings.monthlyTaskLimit": "月任务上限",
  "settings.features": "功能开关",
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

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const getPathValue = (source: Record<string, unknown> | undefined, path: string): unknown => {
  if (!source) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
};

const normalizeValue = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return [...value].sort();
  return value;
};

const formatAuditValue = (value: unknown, path?: string) => {
  if (value === undefined || value === null || value === "") return "未设置";
  if (Array.isArray(value)) {
    if (value.length === 0) return "跟随套餐";
    if (path === "settings.features") {
      return value.map((feature) => featureLabels[String(feature)] || String(feature)).join("、");
    }
    return value.map(String).join("、");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const buildChangeRows = (log: AuditLogEntry) => {
  if (!log.before || !log.after) return [];
  return Object.entries(auditFieldLabels)
    .map(([path, label]) => {
      const before = getPathValue(log.before, path);
      const after = getPathValue(log.after, path);
      return {
        path,
        label,
        before,
        after,
        changed: JSON.stringify(normalizeValue(before)) !== JSON.stringify(normalizeValue(after)),
      };
    })
    .filter((row) => row.changed);
};

const compactJson = (value: unknown) => JSON.stringify(value, null, 2);

function SelectFilter({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-bold text-zinc-800 outline-none focus:border-zinc-500"
    >
      {options.map((option) => (
        <option key={option.value || option.label} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function LogRow({
  log,
  expanded,
  onToggle,
}: {
  log: AuditLogEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusTone = statusClass[log.status] || statusClass.warning;
  const changeRows = buildChangeRows(log);
  const hasDetails = changeRows.length > 0 || Boolean(log.reason || log.metadata || log.related || log.before || log.after);
  return (
    <>
      <tr className="border-b border-zinc-100 last:border-b-0">
        <td className="whitespace-nowrap px-4 py-4 align-top font-mono text-xs font-bold text-zinc-500">
          {formatTime(log.createdAt)}
        </td>
        <td className="px-4 py-4 align-top">
          <div className="font-bold text-zinc-950">{actionLabel[log.action] || log.action}</div>
          <div className="mt-1 max-w-xl text-sm font-medium leading-6 text-zinc-500">
            {log.summary || log.reason || "-"}
          </div>
          {(log.targetType || log.targetId) && (
            <div className="mt-2 font-mono text-[11px] font-bold text-zinc-400">
              {log.targetType || "target"}: {log.targetId || "-"}
            </div>
          )}
          {hasDetails && (
            <button
              type="button"
              onClick={onToggle}
              className="mt-3 rounded-md border border-zinc-200 px-2 py-1 text-xs font-black text-zinc-700 hover:border-zinc-400"
            >
              {expanded ? "收起详情" : "查看详情"}
            </button>
          )}
        </td>
        <td className="whitespace-nowrap px-4 py-4 align-top">
          <span className={`rounded-md border px-2 py-1 text-xs font-bold ${statusTone}`}>
            {log.status}
          </span>
        </td>
        <td className="px-4 py-4 align-top text-sm font-bold text-zinc-700">
          <div>{log.username || log.userId || "anonymous"}</div>
          {log.userRole && <div className="mt-1 text-xs text-zinc-500">{log.userRole}</div>}
        </td>
        <td className="px-4 py-4 align-top font-mono text-xs text-zinc-500">
          <div className="max-w-[180px] truncate">{log.requestId || "-"}</div>
          {log.ip && <div className="mt-1 truncate">{log.ip}</div>}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-zinc-100 bg-[#fbfbf8]">
          <td />
          <td colSpan={4} className="px-4 py-4">
            <div className="text-xs font-black uppercase text-zinc-500">变更详情</div>
            {changeRows.length > 0 ? (
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs font-black text-zinc-500">
                    <tr>
                      <th className="px-3 py-2">字段</th>
                      <th className="px-3 py-2">变更前</th>
                      <th className="px-3 py-2">变更后</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeRows.map((row) => (
                      <tr key={row.path} className="border-t border-zinc-100">
                        <td className="px-3 py-2 font-bold text-zinc-800">{row.label}</td>
                        <td className="max-w-xs px-3 py-2 text-zinc-500">{formatAuditValue(row.before, row.path)}</td>
                        <td className="max-w-xs px-3 py-2 font-semibold text-zinc-900">{formatAuditValue(row.after, row.path)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-2 text-sm font-semibold text-zinc-500">没有结构化字段变更。</div>
            )}
            {log.reason && (
              <div className="mt-3 rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 text-sm font-bold text-[#9f1239]">
                {log.reason}
              </div>
            )}
            {(log.metadata || log.related) && (
              <pre className="mt-3 max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs font-semibold leading-5 text-zinc-600">
                {compactJson({ related: log.related, metadata: log.metadata })}
              </pre>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLogsPage() {
  const { isSuperAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [action, setAction] = useState(searchParams.get("action") || "");
  const [organizationId, setOrganizationId] = useState(searchParams.get("organizationId") || "");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const updateFilters = (next: { category?: string; status?: string; action?: string; organizationId?: string }) => {
    const nextCategory = next.category ?? category;
    const nextStatus = next.status ?? status;
    const nextAction = next.action ?? action;
    const nextOrganizationId = next.organizationId ?? organizationId;
    setCategory(nextCategory);
    setStatus(nextStatus);
    setAction(nextAction);
    setOrganizationId(nextOrganizationId);
    setExpandedLogId(null);
    const params: Record<string, string> = {};
    if (nextCategory) params.category = nextCategory;
    if (nextStatus) params.status = nextStatus;
    if (nextAction) params.action = nextAction;
    if (nextOrganizationId) params.organizationId = nextOrganizationId;
    setSearchParams(params, { replace: true });
  };

  const query = useMemo(() => ({
    organizationId: organizationId || undefined,
    category: category || undefined,
    action: action || undefined,
    status: status || undefined,
    limit: 100,
  }), [organizationId, category, action, status]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", query],
    queryFn: () => getAuditLogs(query),
  });
  const organizationsQuery = useQuery({
    queryKey: ["audit-organizations"],
    queryFn: () => getOrganizations(),
    enabled: isSuperAdmin,
  });

  const logs = data?.data || [];
  const organizationOptions = [
    { value: "", label: "全部组织" },
    ...(organizationsQuery.data?.data || []).map((organization) => ({
      value: organization._id,
      label: organization.name,
    })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-[#b7e3d5] bg-[#e7f3ef] px-3 py-1 text-xs font-black text-[#0f766e]">
            <ShieldCheck size={15} weight="fill" />
            Audit Trail
          </div>
          <h1 className="mt-4 text-3xl font-black text-zinc-950 sm:text-4xl">审计日志</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold leading-7 text-zinc-600">
            记录登录、组织、用户和权限相关动作，方便客户管理员和 AutoArk 运营排障追责。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSuperAdmin && (
            <SelectFilter
              value={organizationId}
              onChange={(value) => updateFilters({ organizationId: value })}
              options={organizationOptions}
            />
          )}
          <SelectFilter value={category} onChange={(value) => updateFilters({ category: value })} options={categories} />
          <SelectFilter value={action} onChange={(value) => updateFilters({ action: value })} options={actionOptions} />
          <SelectFilter value={status} onChange={(value) => updateFilters({ status: value })} options={statuses} />
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-900 hover:border-zinc-400 disabled:opacity-60"
          >
            <FunnelSimple size={17} />
            {isFetching ? "刷新中" : "刷新"}
          </button>
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-zinc-200 bg-white shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-sm font-bold text-zinc-500">
            正在加载审计日志...
          </div>
        ) : error ? (
          <div className="m-5 rounded-lg border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold text-[#9f1239]">
            获取审计日志失败：{(error as Error).message}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-sm font-bold text-zinc-500">
            <ClockCounterClockwise size={28} className="mb-3 text-zinc-400" />
            暂无审计日志
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-zinc-200 bg-[#fbfbf8] text-xs font-black uppercase tracking-normal text-zinc-500">
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">动作</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">操作者</th>
                  <th className="px-4 py-3">请求</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <LogRow
                    key={log._id}
                    log={log}
                    expanded={expandedLogId === log._id}
                    onToggle={() => setExpandedLogId(expandedLogId === log._id ? null : log._id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
