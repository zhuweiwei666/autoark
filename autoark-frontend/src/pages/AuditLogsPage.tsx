import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClockCounterClockwise, FunnelSimple, ShieldCheck } from "@phosphor-icons/react";
import { getAuditLogs, type AuditLogEntry } from "../services/api";

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
  "facebook_app.create": "创建 Facebook App",
  "facebook_app.update": "更新 Facebook App",
  "facebook_app.delete": "删除 Facebook App",
  "facebook_app.validate": "验证 Facebook App",
  "facebook_app.compliance_update": "更新 App 合规",
  "commercial.support_package.generate": "生成客户支持包",
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

function LogRow({ log }: { log: AuditLogEntry }) {
  const statusTone = statusClass[log.status] || statusClass.warning;
  return (
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
  );
}

export default function AuditLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [action, setAction] = useState(searchParams.get("action") || "");

  const updateFilters = (next: { category?: string; status?: string; action?: string }) => {
    const nextCategory = next.category ?? category;
    const nextStatus = next.status ?? status;
    const nextAction = next.action ?? action;
    setCategory(nextCategory);
    setStatus(nextStatus);
    setAction(nextAction);
    const params: Record<string, string> = {};
    if (nextCategory) params.category = nextCategory;
    if (nextStatus) params.status = nextStatus;
    if (nextAction) params.action = nextAction;
    setSearchParams(params, { replace: true });
  };

  const query = useMemo(() => ({
    category: category || undefined,
    action: action || undefined,
    status: status || undefined,
    limit: 100,
  }), [category, action, status]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", query],
    queryFn: () => getAuditLogs(query),
  });

  const logs = data?.data || [];

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
                  <LogRow key={log._id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
