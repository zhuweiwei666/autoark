import { useEffect, useMemo, useState } from "react";
import {
  CheckSquareOffset,
  GlobeHemisphereWest,
  ImageSquare,
  Lightning,
  Megaphone,
  Pulse,
  Robot,
  Stack,
} from "@phosphor-icons/react";
import {
  approveReplica,
  createReplica,
  evaluateReplica,
  generatePlaybook,
  getOptimizers,
  getPlaybookById,
  getPlaybookGeneration,
  getReplicaAssets,
  getReplicas,
  publishReplica,
  type OptimizerPlaybook,
  type OptimizerSummary,
  type RankedPerformance,
  type ReplicaAssetAccount,
  type ReplicaAssetToken,
  type ReplicaRun,
} from "../services/optimizerLearning";

type Notice = { type: "success" | "error" | "info"; text: string };
type AccountChoice = { selected: boolean; pageId: string; pixelId: string };

const statusStyles: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  blocked: "bg-rose-50 text-rose-700 ring-rose-200",
  approval_required: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-sky-50 text-sky-700 ring-sky-200",
  publishing: "bg-violet-50 text-violet-700 ring-violet-200",
  published: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-orange-50 text-orange-700 ring-orange-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  evaluating: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  completed: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

const statusLabels: Record<string, string> = {
  ready: "可复制",
  blocked: "未达门槛",
  building: "生成中",
  approval_required: "待人工审批",
  approved: "已审批",
  publishing: "创建 PAUSED 对象中",
  published: "已创建 PAUSED 对象",
  partial: "部分完成",
  failed: "失败",
  evaluating: "等待效果数据",
  completed: "已评估",
};

const StatusBadge = ({ status }: { status: string }) => (
  <span
    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${statusStyles[status] || "bg-zinc-100 text-zinc-700 ring-zinc-200"}`}
  >
    {statusLabels[status] || status}
  </span>
);

const formatNumber = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "未知"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });

const formatDate = (value?: string) => {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const rankingLabel = (
  item: RankedPerformance,
  kind: "geo" | "placement" | "hour",
) => {
  if (kind === "geo") return item.dimension?.country || item.key;
  if (kind === "hour") return item.dimension?.hour || item.key;
  return (
    [
      item.dimension?.publisherPlatform,
      item.dimension?.platformPosition,
      item.dimension?.impressionDevice,
    ]
      .filter(Boolean)
      .join(" · ") || item.key
  );
};

const RankingList = ({
  title,
  items,
  kind,
}: {
  title: string;
  items: RankedPerformance[];
  kind: "geo" | "placement" | "hour";
}) => (
  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-black text-zinc-900">{title}</h3>
      <span className="text-xs font-semibold text-zinc-400">
        {items.length ? "按置信度校正后的表现排序" : "暂无数据"}
      </span>
    </div>
    <div className="space-y-2">
      {items.slice(0, 5).map((item, index) => (
        <div
          key={item.key}
          className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3 py-2.5"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-black text-white">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-zinc-800">
              {rankingLabel(item, kind)}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              购买 {formatNumber(item.purchases, 0)} · ROAS{" "}
              {formatNumber(item.roas)} · 置信度{" "}
              {Math.round(item.confidence * 100)}%
            </p>
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-6 text-center text-xs text-zinc-400">
          当前维度为未知，不会按 0 处理
        </div>
      )}
    </div>
  </div>
);

export default function AiOptimizerPage() {
  const [optimizers, setOptimizers] = useState<OptimizerSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [playbook, setPlaybook] = useState<OptimizerPlaybook | null>(null);
  const [replicas, setReplicas] = useState<ReplicaRun[]>([]);
  const [tokens, setTokens] = useState<ReplicaAssetToken[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [accountChoices, setAccountChoices] = useState<
    Record<string, AccountChoice>
  >({});
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [windowDays, setWindowDays] = useState(14);
  const [dailyBudget, setDailyBudget] = useState(20);
  const [materialLimit, setMaterialLimit] = useState(3);
  const [applyTopCountries, setApplyTopCountries] = useState(true);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionRunId, setActionRunId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  const selectedOptimizer = useMemo(
    () =>
      optimizers.find(
        (optimizer) =>
          `${optimizer.scopeKey}:${optimizer.optimizerId}` === selectedKey,
      ),
    [optimizers, selectedKey],
  );
  const selectedToken = useMemo(
    () => tokens.find((token) => token.tokenId === selectedTokenId),
    [tokens, selectedTokenId],
  );
  const selectedAccounts = useMemo(
    () =>
      (selectedToken?.accounts || []).filter(
        (account) => accountChoices[account.accountId]?.selected,
      ),
    [selectedToken, accountChoices],
  );

  const initializeToken = (token?: ReplicaAssetToken) => {
    if (!token) {
      setSelectedTokenId("");
      setAccountChoices({});
      return;
    }
    setSelectedTokenId(token.tokenId);
    setAccountChoices(
      Object.fromEntries(
        token.accounts.map((account) => [
          account.accountId,
          {
            selected: false,
            pageId: account.pages.length === 1 ? account.pages[0].pageId : "",
            pixelId:
              account.pixels.length === 1 ? account.pixels[0].pixelId : "",
          },
        ]),
      ),
    );
  };

  const loadAssets = async (nextPlaybook: OptimizerPlaybook) => {
    try {
      const data = await getReplicaAssets(nextPlaybook._id);
      setTokens(data.tokens);
      initializeToken(data.tokens[0]);
    } catch (error: any) {
      setTokens([]);
      initializeToken(undefined);
      setNotice({
        type: "error",
        text: error.message || "目标账户资产加载失败",
      });
    }
  };

  const selectOptimizer = async (optimizer: OptimizerSummary) => {
    const key = `${optimizer.scopeKey}:${optimizer.optimizerId}`;
    const defaultCurrency = optimizer.currencies?.[0]?.currency || "";
    setSelectedKey(key);
    setSelectedCurrency(defaultCurrency);
    setPlaybook(null);
    setTokens([]);
    initializeToken(undefined);
    if (!optimizer.latestPlaybookId) return;
    try {
      const latest = await getPlaybookById(optimizer.latestPlaybookId);
      setPlaybook(latest);
      if (latest.source.currencies?.length === 1) {
        setSelectedCurrency(latest.source.currencies[0]);
      }
      setDailyBudget(latest.guardrails.suggestedPilotDailyBudget);
      if (latest.eligibility.eligible) await loadAssets(latest);
    } catch (error: any) {
      setNotice({ type: "error", text: error.message || "打法版本加载失败" });
    }
  };

  const refreshReplicas = async () => {
    try {
      setReplicas(await getReplicas());
    } catch (error: any) {
      setNotice({ type: "error", text: error.message || "复制任务加载失败" });
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [optimizerRows, replicaRows] = await Promise.all([
          getOptimizers(),
          getReplicas(),
        ]);
        setOptimizers(optimizerRows);
        setReplicas(replicaRows);
        if (optimizerRows[0]) await selectOptimizer(optimizerRows[0]);
      } catch (error: any) {
        setNotice({
          type: "error",
          text: error.message || "AI 投手工作台加载失败",
        });
      } finally {
        setLoading(false);
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    if (!selectedOptimizer) return;
    setGenerating(true);
    setNotice({
      type: "info",
      text: "正在提交异步学习任务；页面会持续跟踪，不受代理超时影响…",
    });
    try {
      const requested = await generatePlaybook(selectedOptimizer.optimizerId, {
        organizationId: selectedOptimizer.organizationId,
        currency: selectedCurrency || undefined,
        windowDays,
        refreshInsights: true,
      });
      let generation = requested.generation;
      const deadline = Date.now() + 15 * 60 * 1000;
      while (
        ["queued", "running"].includes(generation.status) &&
        Date.now() < deadline
      ) {
        setNotice({
          type: "info",
          text:
            generation.status === "queued"
              ? "打法学习任务已排队，等待执行…"
              : "正在实时拉取地区、版位和小时表现，并生成不可变版本…",
        });
        await wait(2000);
        generation = await getPlaybookGeneration(generation._id);
      }
      if (generation.status === "failed") {
        throw new Error(generation.error || "打法生成任务失败");
      }
      if (generation.status !== "completed" || !generation.playbookId) {
        throw new Error(
          "打法仍在后台生成，请稍后刷新；重复点击不会创建第二个任务",
        );
      }
      const generated = await getPlaybookById(generation.playbookId);
      setPlaybook(generated);
      setDailyBudget(generated.guardrails.suggestedPilotDailyBudget);
      setOptimizers((current) =>
        current.map((optimizer) =>
          `${optimizer.scopeKey}:${optimizer.optimizerId}` === selectedKey
            ? {
                ...optimizer,
                latestPlaybookId: generated._id,
                lastGeneratedAt: generated.generatedAt,
                versionCount: generated.version,
                lastEligibility: generated.eligibility,
              }
            : optimizer,
        ),
      );
      if (generated.eligibility.eligible) await loadAssets(generated);
      setNotice({
        type: generated.eligibility.eligible ? "success" : "error",
        text: generated.eligibility.eligible
          ? `打法 v${generated.version} 已生成，可创建 PAUSED 试投草稿`
          : `打法 v${generated.version} 已生成，但证据门槛未通过`,
      });
    } catch (error: any) {
      setNotice({ type: "error", text: error.message || "打法生成失败" });
    } finally {
      setGenerating(false);
    }
  };

  const switchToken = (tokenId: string) => {
    initializeToken(tokens.find((token) => token.tokenId === tokenId));
  };

  const switchCurrency = (currency: string) => {
    if (currency === selectedCurrency) return;
    setSelectedCurrency(currency);
    setPlaybook(null);
    setTokens([]);
    initializeToken(undefined);
    setNotice({
      type: "info",
      text: `已切换到 ${currency || "未知"} 币种，请生成该币种的独立打法版本`,
    });
  };

  const updateChoice = (accountId: string, patch: Partial<AccountChoice>) => {
    setAccountChoices((current) => ({
      ...current,
      [accountId]: { ...current[accountId], ...patch },
    }));
  };

  const handleCreateReplica = async () => {
    if (!playbook || !selectedToken) return;
    if (selectedAccounts.length === 0) {
      setNotice({ type: "error", text: "请至少选择一个目标广告账户" });
      return;
    }
    setCreating(true);
    try {
      const result = await createReplica(playbook._id, {
        facebookTokenId: selectedToken.tokenId,
        accounts: selectedAccounts.map((account) => ({
          accountId: account.accountId,
          accountName: account.name,
          pageId: accountChoices[account.accountId]?.pageId || undefined,
          pixelId: accountChoices[account.accountId]?.pixelId || undefined,
          conversionEvent: "PURCHASE",
        })),
        dailyBudget,
        materialLimit,
        applyTopCountries,
        countryLimit: 5,
      });
      await refreshReplicas();
      setNotice({
        type: result.validation?.isValid ? "success" : "error",
        text: result.validation?.isValid
          ? "PAUSED 草稿已生成并通过预检，等待人工审批"
          : "草稿已生成，但预检存在阻断项",
      });
    } catch (error: any) {
      const details = error.details?.candidates?.length
        ? `；可选资产：${error.details.candidates.map((candidate: any) => candidate.name || candidate.id).join("、")}`
        : "";
      setNotice({
        type: "error",
        text: `${error.message || "复制草稿创建失败"}${details}`,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRunAction = async (
    run: ReplicaRun,
    action: "approve" | "publish" | "evaluate",
  ) => {
    const confirmation =
      action === "approve"
        ? "确认审批该 PAUSED 草稿？审批不会启用广告。"
        : action === "publish"
          ? "确认向 Meta 创建 Campaign / AdSet / Ad？三层状态都会保持 PAUSED。"
          : null;
    if (confirmation && !window.confirm(confirmation)) return;
    setActionRunId(run._id);
    try {
      if (action === "approve") await approveReplica(run._id);
      if (action === "publish") await publishReplica(run._id);
      if (action === "evaluate") await evaluateReplica(run._id);
      await refreshReplicas();
      setNotice({
        type: "success",
        text:
          action === "approve"
            ? "已审批，仍保持 PAUSED"
            : action === "publish"
              ? "PAUSED 发布任务已创建"
              : "效果对比已刷新；缺失数据继续显示为未知",
      });
    } catch (error: any) {
      setNotice({ type: "error", text: error.message || "操作失败" });
    } finally {
      setActionRunId("");
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="mx-auto max-w-7xl rounded-3xl border border-zinc-200 bg-white p-10 text-center text-sm font-semibold text-zinc-500">
          正在加载投手血缘与打法版本…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-zinc-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="overflow-hidden rounded-3xl bg-zinc-950 p-6 text-white shadow-2xl shadow-zinc-900/10 sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-zinc-200 ring-1 ring-white/15">
                <Robot size={16} weight="fill" />
                AI 投手 · 可审计复制
              </div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                从真人投手数据，生成可控的 AI 试投
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-300">
                实时学习广告结构、素材、地域、版位和高转化小时。AI 只创建 PAUSED
                草稿与对象；审批、发布、启用是三道独立边界。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["投手", optimizers.length],
                [
                  "打法",
                  optimizers.reduce(
                    (sum, item) => sum + (item.versionCount || 0),
                    0,
                  ),
                ],
                ["复制任务", replicas.length],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="min-w-20 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/10"
                >
                  <p className="text-xl font-black">{value}</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-zinc-400">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </header>

        {notice && (
          <div
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold ${
              notice.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : notice.type === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-sky-200 bg-sky-50 text-sky-800"
            }`}
          >
            <span>{notice.text}</span>
            <button
              className="rounded-lg px-2 py-1 hover:bg-white/60"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}

        <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-3xl border border-zinc-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-black text-zinc-900">
                已绑定真人投手
              </h2>
              <span className="text-xs font-semibold text-zinc-400">
                {optimizers.length} 人
              </span>
            </div>
            <div className="space-y-2">
              {optimizers.map((optimizer) => {
                const key = `${optimizer.scopeKey}:${optimizer.optimizerId}`;
                const active = key === selectedKey;
                return (
                  <button
                    key={key}
                    onClick={() => void selectOptimizer(optimizer)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white shadow-lg shadow-zinc-900/10"
                        : "border-zinc-200 bg-white hover:border-zinc-400"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-black">
                        {optimizer.displayName}
                      </p>
                      {optimizer.lastEligibility && (
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${optimizer.lastEligibility.eligible ? "bg-emerald-400" : "bg-amber-400"}`}
                        />
                      )}
                    </div>
                    <p
                      className={`mt-1 text-xs ${active ? "text-zinc-400" : "text-zinc-500"}`}
                    >
                      {optimizer.activeAccounts}/{optimizer.accountCount}{" "}
                      个活跃账户 · v{optimizer.versionCount || 0}
                    </p>
                    <p
                      className={`mt-1 truncate text-[11px] ${active ? "text-zinc-500" : "text-zinc-400"}`}
                    >
                      币种：
                      {optimizer.currencies
                        ?.map((item) => item.currency)
                        .join("、") || "未知"}
                    </p>
                    <p
                      className={`mt-2 truncate text-[11px] ${active ? "text-zinc-500" : "text-zinc-400"}`}
                    >
                      最近结构同步：{formatDate(optimizer.latestSourceSyncedAt)}
                    </p>
                  </button>
                );
              })}
              {optimizers.length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-xs leading-5 text-zinc-500">
                  暂无带 optimizer 标签的活跃账户。先在 Token
                  设置中绑定投手并同步账户。
                </div>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                    Learn
                  </p>
                  <h2 className="mt-1 text-xl font-black text-zinc-950">
                    {selectedOptimizer
                      ? `${selectedOptimizer.displayName} 的最新打法`
                      : "选择一名投手"}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    每次生成都会保存不可变版本，不覆盖历史证据。
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <label className="text-xs font-bold text-zinc-600">
                    学习币种
                    <select
                      value={selectedCurrency}
                      onChange={(event) =>
                        switchCurrency(event.target.value)
                      }
                      className="mt-1 block rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800"
                    >
                      {(selectedOptimizer?.currencies || []).map((item) => (
                        <option key={item.currency} value={item.currency}>
                          {item.currency} · {item.activeAccounts}/
                          {item.accountCount} 活跃
                        </option>
                      ))}
                      {!selectedOptimizer?.currencies?.length && (
                        <option value="">币种未知</option>
                      )}
                    </select>
                  </label>
                  <label className="text-xs font-bold text-zinc-600">
                    分析窗口
                    <select
                      value={windowDays}
                      onChange={(event) =>
                        setWindowDays(Number(event.target.value))
                      }
                      className="mt-1 block rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800"
                    >
                      <option value={7}>近 7 天</option>
                      <option value={14}>近 14 天</option>
                      <option value={30}>近 30 天</option>
                    </select>
                  </label>
                  <button
                    disabled={!selectedOptimizer || generating}
                    onClick={() => void handleGenerate()}
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Lightning size={17} weight="fill" />
                    {generating ? "实时学习中…" : "生成最新打法"}
                  </button>
                </div>
              </div>

              {playbook ? (
                <div className="mt-6 space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      [
                        "版本 / 状态",
                        <span className="flex items-center gap-2" key="version">
                          v{playbook.version}{" "}
                          <StatusBadge status={playbook.status} />
                        </span>,
                      ],
                      [
                        "证据置信度",
                        `${playbook.confidence.score} · ${playbook.confidence.level.toUpperCase()}`,
                      ],
                      [
                        "来源基线",
                        `ROAS ${formatNumber(playbook.baseline.roas)} · ${formatNumber(playbook.baseline.purchases, 0)} 单`,
                      ],
                      [
                        "数据覆盖",
                        `${playbook.coverage.countries} 地区 · ${playbook.coverage.placements} 版位 · ${playbook.coverage.hours} 小时`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={String(label)}
                        className="rounded-2xl bg-zinc-50 p-4"
                      >
                        <p className="text-[11px] font-bold text-zinc-400">
                          {label}
                        </p>
                        <div className="mt-1.5 text-sm font-black text-zinc-900">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-zinc-200 p-4">
                      <div className="flex items-center gap-2 text-zinc-900">
                        <Stack size={18} />
                        <h3 className="text-sm font-black">广告结构</h3>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-600">
                        {playbook.structure.budgetOptimization ? "CBO" : "ABO"}{" "}
                        · {playbook.structure.adsetsPerCampaign} 组/系列 ·{" "}
                        {playbook.structure.adsPerAdset} 广告/组
                      </p>
                      <p className="text-xs leading-5 text-zinc-600">
                        {playbook.structure.objective} ·{" "}
                        {playbook.structure.optimizationGoal}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 p-4">
                      <div className="flex items-center gap-2 text-zinc-900">
                        <ImageSquare size={18} />
                        <h3 className="text-sm font-black">素材与文案</h3>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-600">
                        {playbook.creatives.materials.length} 个可复用高表现素材
                        · {playbook.copywriting.headlines.length} 条标题
                      </p>
                      <p className="truncate text-xs leading-5 text-zinc-500">
                        {playbook.copywriting.websiteUrl || "落地页未知"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 p-4">
                      <div className="flex items-center gap-2 text-zinc-900">
                        <CheckSquareOffset size={18} />
                        <h3 className="text-sm font-black">执行护栏</h3>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-zinc-600">
                        建议试投 {playbook.guardrails.suggestedPilotDailyBudget}{" "}
                        {playbook.structure.currency || ""}/日
                      </p>
                      <p className="text-xs font-bold leading-5 text-emerald-700">
                        Campaign / AdSet / Ad 全部 PAUSED
                      </p>
                    </div>
                  </div>

                  {(playbook.eligibility.blockers.length > 0 ||
                    playbook.eligibility.warnings.length > 0) && (
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
                        <p className="text-xs font-black text-rose-800">
                          阻断项
                        </p>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-rose-700">
                          {playbook.eligibility.blockers.length ? (
                            playbook.eligibility.blockers.map((item) => (
                              <li key={item}>• {item}</li>
                            ))
                          ) : (
                            <li>无</li>
                          )}
                        </ul>
                      </div>
                      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                        <p className="text-xs font-black text-amber-800">
                          注意项
                        </p>
                        <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-700">
                          {playbook.eligibility.warnings.length ? (
                            playbook.eligibility.warnings.map((item) => (
                              <li key={item}>• {item}</li>
                            ))
                          ) : (
                            <li>无</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-3 xl:grid-cols-3">
                    <RankingList
                      title="高转化地区"
                      items={playbook.geography}
                      kind="geo"
                    />
                    <RankingList
                      title="高转化版位"
                      items={playbook.placements}
                      kind="placement"
                    />
                    <RankingList
                      title="高转化小时（账户时区）"
                      items={playbook.hours}
                      kind="hour"
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed border-zinc-200 p-10 text-center text-sm text-zinc-500">
                  选择投手后生成第一版打法；该动作只读取 Meta 数据，不创建广告。
                </div>
              )}
            </div>

            {playbook?.eligibility.eligible && (
              <div className="rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                      Replicate
                    </p>
                    <h2 className="mt-1 text-xl font-black text-zinc-950">
                      创建 PAUSED 试投草稿
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      选择同一枚个人授权下的账户、Page 和
                      Pixel；不会在此步骤调用 Meta 写接口。
                    </p>
                  </div>
                  <Megaphone size={26} className="text-zinc-400" />
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="space-y-4 rounded-2xl bg-zinc-50 p-4">
                    <label className="block text-xs font-bold text-zinc-600">
                      目标 Facebook 授权
                      <select
                        value={selectedTokenId}
                        onChange={(event) => switchToken(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold"
                      >
                        {tokens.map((token) => (
                          <option key={token.tokenId} value={token.tokenId}>
                            {token.fbUserName ||
                              token.optimizer ||
                              token.tokenId.slice(-8)}{" "}
                            · {token.accounts.length} 账户
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs font-bold text-zinc-600">
                        单账户日预算
                        <input
                          type="number"
                          min={1}
                          max={playbook.guardrails.maximumPilotDailyBudget}
                          value={dailyBudget}
                          onChange={(event) =>
                            setDailyBudget(Number(event.target.value))
                          }
                          className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold"
                        />
                      </label>
                      <label className="text-xs font-bold text-zinc-600">
                        素材数
                        <select
                          value={materialLimit}
                          onChange={(event) =>
                            setMaterialLimit(Number(event.target.value))
                          }
                          className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold"
                        >
                          {[1, 2, 3, 5].map((count) => (
                            <option key={count} value={count}>
                              {count}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={applyTopCountries}
                        onChange={(event) =>
                          setApplyTopCountries(event.target.checked)
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <strong className="text-zinc-900">
                          收敛到高转化国家
                        </strong>
                        <br />
                        会记录为 AI 修改；版位保持来源定向，小时仅给建议。
                      </span>
                    </label>
                    <button
                      disabled={
                        creating ||
                        selectedAccounts.length === 0 ||
                        !selectedToken
                      }
                      onClick={() => void handleCreateReplica()}
                      className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {creating
                        ? "生成并预检中…"
                        : `生成 ${selectedAccounts.length || 0} 个账户的 PAUSED 草稿`}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {(selectedToken?.accounts || []).map(
                      (account: ReplicaAssetAccount) => {
                        const choice = accountChoices[account.accountId];
                        const ready =
                          account.status === 1 &&
                          account.pages.length > 0 &&
                          account.pixels.length > 0 &&
                          (!playbook.structure.currency ||
                            account.currency === playbook.structure.currency);
                        return (
                          <div
                            key={account.accountId}
                            className={`rounded-2xl border p-4 ${choice?.selected ? "border-zinc-900 bg-white" : "border-zinc-200 bg-zinc-50/50"}`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={choice?.selected || false}
                                disabled={!ready}
                                onChange={(event) =>
                                  updateChoice(account.accountId, {
                                    selected: event.target.checked,
                                  })
                                }
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-black text-zinc-900">
                                  {account.name || account.accountId}
                                </p>
                                <p className="text-[11px] text-zinc-500">
                                  {account.accountId} ·{" "}
                                  {account.currency || "币种未知"} ·{" "}
                                  {ready
                                    ? "资产就绪"
                                    : playbook.structure.currency &&
                                        account.currency !==
                                          playbook.structure.currency
                                      ? `需 ${playbook.structure.currency} 账户`
                                      : "Page/Pixel 未就绪"}
                                </p>
                              </div>
                            </div>
                            {choice?.selected && (
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <select
                                  value={choice.pageId}
                                  onChange={(event) =>
                                    updateChoice(account.accountId, {
                                      pageId: event.target.value,
                                    })
                                  }
                                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold"
                                >
                                  <option value="">选择 Page</option>
                                  {account.pages.map((page) => (
                                    <option
                                      key={page.pageId}
                                      value={page.pageId}
                                    >
                                      {page.name || page.pageId}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={choice.pixelId}
                                  onChange={(event) =>
                                    updateChoice(account.accountId, {
                                      pixelId: event.target.value,
                                    })
                                  }
                                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold"
                                >
                                  <option value="">选择 Pixel</option>
                                  {account.pixels.map((pixel) => (
                                    <option
                                      key={pixel.pixelId}
                                      value={pixel.pixelId}
                                    >
                                      {pixel.name || pixel.pixelId}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>
                        );
                      },
                    )}
                    {tokens.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-zinc-200 p-8 text-center text-xs text-zinc-500">
                        当前范围没有完成资产同步的活跃 Facebook 授权。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                Operate
              </p>
              <h2 className="mt-1 text-xl font-black text-zinc-950">
                AI 复制任务
              </h2>
            </div>
            <button
              onClick={() => void refreshReplicas()}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50"
            >
              刷新
            </button>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-zinc-200 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  <th className="px-3 py-3">投手 / 版本</th>
                  <th className="px-3 py-3">目标</th>
                  <th className="px-3 py-3">状态</th>
                  <th className="px-3 py-3">预检 / 任务</th>
                  <th className="px-3 py-3">创建时间</th>
                  <th className="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {replicas.map((run) => {
                  const status = run.effectiveStatus || run.status;
                  const busy = actionRunId === run._id;
                  return (
                    <tr
                      key={run._id}
                      className="border-b border-zinc-100 text-sm last:border-0"
                    >
                      <td className="px-3 py-4">
                        <p className="font-black text-zinc-900">
                          {run.optimizerId} · v{run.playbookVersion}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                          {run._id}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-xs text-zinc-600">
                        {run.targets?.accountIds?.length || 0} 账户 ·{" "}
                        {run.targets?.dailyBudget || "-"}{" "}
                        {run.targets?.currency || ""}/日
                      </td>
                      <td className="px-3 py-4">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-3 py-4 text-xs text-zinc-600">
                        <p>
                          {run.validation?.isValid
                            ? "预检通过"
                            : run.validation
                              ? `${run.validation.errors?.length || 0} 个阻断`
                              : "预检未知"}
                        </p>
                        <p className="mt-0.5 text-zinc-400">
                          {run.task
                            ? `Meta 任务：${run.task.status}`
                            : "尚未调用 Meta 写接口"}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-xs text-zinc-500">
                        {formatDate(run.createdAt)}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-2">
                          {status === "approval_required" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void handleRunAction(run, "approve")
                              }
                              className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-50"
                            >
                              人工审批
                            </button>
                          )}
                          {status === "approved" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void handleRunAction(run, "publish")
                              }
                              className="rounded-lg bg-zinc-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                            >
                              创建 PAUSED 对象
                            </button>
                          )}
                          {[
                            "published",
                            "partial",
                            "evaluating",
                            "completed",
                          ].includes(status) && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void handleRunAction(run, "evaluate")
                              }
                              className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 disabled:opacity-50"
                            >
                              刷新效果
                            </button>
                          )}
                          {busy && (
                            <span className="px-2 py-2 text-xs font-semibold text-zinc-400">
                              处理中…
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {replicas.length === 0 && (
              <div className="py-12 text-center text-sm text-zinc-500">
                还没有 AI 复制任务。
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            [
              GlobeHemisphereWest,
              "地域与版位",
              "基于实时 Insights 分维度采集，失败维度独立降级。",
            ],
            [
              Pulse,
              "未知不等于 0",
              "缺失归因、版位或效果时会明确标记未知，不会虚构赢家。",
            ],
            [
              Robot,
              "不会自动启用",
              "当前能力只到 PAUSED 对象；启用与放量仍需独立决策。",
            ],
          ].map(([Icon, title, description]) => {
            const CardIcon = Icon as typeof Robot;
            return (
              <div
                key={String(title)}
                className="rounded-2xl border border-zinc-200 bg-white p-4"
              >
                <CardIcon size={20} className="text-zinc-700" />
                <p className="mt-3 text-sm font-black text-zinc-900">
                  {String(title)}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {String(description)}
                </p>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
