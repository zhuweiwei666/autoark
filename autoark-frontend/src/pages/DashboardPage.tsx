import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowClockwise,
  ChartLineUp,
  CurrencyDollar,
  Pulse,
  TrendDown,
  TrendUp,
  Wallet,
} from "@phosphor-icons/react";
import {
  getAggAccountRanking,
  getAggCampaignRanking,
  getAggCoreMetrics,
  getAggTrend,
  type CoreMetrics,
} from "../services/api";

const getSessionCacheScope = () => {
  const token = localStorage.getItem("auth_token");
  if (!token) return "anonymous";

  // 缓存键不能暴露 token 本身，同时必须隔离不同登录会话。
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getCacheKey = () => `dashboard_7days_${getSessionCacheScope()}`;

const loadFromCache = () => {
  try {
    const cached = localStorage.getItem(getCacheKey());
    if (!cached) return null;
    const data = JSON.parse(cached);
    if (data.timestamp && Date.now() - data.timestamp < 5 * 60 * 1000) {
      return data;
    }
  } catch (error) {
    console.error("Failed to load dashboard cache:", error);
  }
  return null;
};

const saveToCache = (data: any) => {
  try {
    localStorage.setItem(
      getCacheKey(),
      JSON.stringify({ ...data, timestamp: Date.now() }),
    );
  } catch (error) {
    console.error("Failed to save dashboard cache:", error);
  }
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(Number.isFinite(value) ? value : 0);

const formatDecimal = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : "0.00";

const shortDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

const longDate = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "日期未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

function MetricTile({
  label,
  value,
  detail,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "default" | "positive" | "negative";
  icon: ReactNode;
}) {
  const toneClass = {
    default: "text-zinc-500",
    positive: "text-[#15803d]",
    negative: "text-[#b4233a]",
  }[tone];

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-bold text-zinc-500">{label}</div>
          <div className="mt-4 font-mono text-3xl font-bold leading-none text-zinc-950">
            {value}
          </div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#edf4f1] text-[#0f766e]">
          {icon}
        </div>
      </div>
      {detail && (
        <div className={`mt-4 text-sm font-bold ${toneClass}`}>{detail}</div>
      )}
    </article>
  );
}

function MiniLineChart({
  data,
  valueKey,
  color,
  valueLabel,
  formatValue,
}: {
  data: any[];
  valueKey: string;
  color: string;
  valueLabel: string;
  formatValue: (value: number) => string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const values = data.map((item) => Number(item[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const pointCoordinates = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 84 - 8;
    return { x, y };
  });
  const points = pointCoordinates
    .map(({ x, y }) => `${x},${y}`)
    .join(" ");
  const activePoint =
    activeIndex !== null && activeIndex < data.length
      ? {
          ...pointCoordinates[activeIndex],
          date: String(data[activeIndex]?.date || ""),
          value: values[activeIndex],
        }
      : null;
  const tooltipX = activePoint
    ? Math.min(Math.max(activePoint.x, 24), 76)
    : 50;

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0) return;

    const ratio = Math.min(
      Math.max((event.clientX - bounds.left) / bounds.width, 0),
      1,
    );
    setActiveIndex(Math.round(ratio * (data.length - 1)));
  };

  const clearActivePoint = () => setActiveIndex(null);

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") {
      clearActivePoint();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    setActiveIndex((current) => {
      const startIndex = current ?? data.length - 1;
      return event.key === "ArrowLeft"
        ? Math.max(startIndex - 1, 0)
        : Math.min(startIndex + 1, data.length - 1);
    });
  };

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-[#fbfbf8] text-sm font-semibold text-zinc-500">
        暂无趋势数据
      </div>
    );
  }

  return (
    <div className="h-64 rounded-lg border border-zinc-200 bg-[#fbfbf8] p-4">
      <div className="relative h-48">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full cursor-crosshair overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-2"
          tabIndex={0}
          aria-label={
            activePoint
              ? `${longDate(activePoint.date)}，${valueLabel} ${formatValue(activePoint.value)}`
              : `${valueLabel}趋势图。悬浮或使用左右方向键查看每日数据。`
          }
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerMove}
          onPointerLeave={clearActivePoint}
          onFocus={() =>
            setActiveIndex((current) => current ?? data.length - 1)
          }
          onBlur={clearActivePoint}
          onKeyDown={handleKeyDown}
        >
          <line
            x1="0"
            y1="92"
            x2="100"
            y2="92"
            stroke="#d4d4d0"
            strokeWidth="0.6"
          />
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            stroke="#e7e5e4"
            strokeWidth="0.4"
          />
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {activePoint && (
            <line
              x1={activePoint.x}
              y1="8"
              x2={activePoint.x}
              y2="92"
              stroke={color}
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.45"
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
          )}
        </svg>
        {activePoint && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-[#fbfbf8]"
              style={{
                left: `${activePoint.x}%`,
                top: `${activePoint.y}%`,
                borderColor: color,
              }}
            />
            <div
              role="tooltip"
              className="pointer-events-none absolute top-3 min-w-32 -translate-x-1/2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-left shadow-[0_14px_28px_-18px_rgba(24,24,27,0.9)]"
              style={{ left: `${tooltipX}%` }}
            >
              <div className="whitespace-nowrap text-[11px] font-semibold text-zinc-300">
                {longDate(activePoint.date)}
              </div>
              <div className="mt-1 whitespace-nowrap font-mono text-sm font-bold text-white">
                {valueLabel} {formatValue(activePoint.value)}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="mt-3 flex justify-between text-xs font-semibold text-zinc-500">
        <span>{shortDate(data[0]?.date || "")}</span>
        <span>{shortDate(data[data.length - 1]?.date || "")}</span>
      </div>
    </div>
  );
}

function BarList({
  title,
  data,
  nameKey,
}: {
  title: string;
  data: any[];
  nameKey: "campaignName" | "accountName";
}) {
  const topRows = data.slice(0, 8);
  const maxSpend = Math.max(
    ...topRows.map((item) => Number(item.spend || 0)),
    1,
  );

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h3 className="text-base font-extrabold text-zinc-950">{title}</h3>
        <span className="font-mono text-xs font-bold text-zinc-500">
          Top {topRows.length}
        </span>
      </div>
      {topRows.length ? (
        <div className="space-y-4">
          {topRows.map((item, index) => {
            const name =
              item[nameKey] || item.campaignId || item.accountId || "Unknown";
            const spend = Number(item.spend || 0);
            const width = Math.max(6, (spend / maxSpend) * 100);
            return (
              <div key={`${name}-${index}`} className="space-y-2">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <div className="min-w-0 truncate font-bold text-zinc-800">
                    {name}
                  </div>
                  <div className="font-mono font-bold text-zinc-950">
                    {formatCurrency(spend)}
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-zinc-900"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-[#fbfbf8] text-sm font-semibold text-zinc-500">
          暂无排行数据
        </div>
      )}
    </section>
  );
}

export default function DashboardPage() {
  const [coreMetrics, setCoreMetrics] = useState<CoreMetrics | null>(null);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [campaignRanking, setCampaignRanking] = useState<any[]>([]);
  const [accountRanking, setAccountRanking] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = async () => {
    setIsRefreshing(true);
    setLoadError("");
    const startTime = performance.now();

    try {
      const [metricsRes, trendRes, campaignRes, accountRes] = await Promise.all(
        [
          getAggCoreMetrics(),
          getAggTrend(7),
          getAggCampaignRanking(10),
          getAggAccountRanking(10),
        ],
      );

      const data = {
        coreMetrics: metricsRes.data,
        trendData: trendRes.data || [],
        campaignRanking: campaignRes.data || [],
        accountRanking: accountRes.data || [],
      };

      setCoreMetrics(data.coreMetrics);
      setTrendData(data.trendData);
      setCampaignRanking(data.campaignRanking);
      setAccountRanking(data.accountRanking);
      setLastUpdated(new Date());
      saveToCache(data);

      const duration = (performance.now() - startTime).toFixed(0);
      console.log(`Dashboard loaded in ${duration}ms`);
    } catch (error: any) {
      setLoadError(error?.message || "数据加载失败");
      console.error("Failed to load dashboard data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const cached = loadFromCache();
    if (cached) {
      setCoreMetrics(cached.coreMetrics);
      setTrendData(cached.trendData || cached.spendTrend || []);
      setCampaignRanking(cached.campaignRanking || []);
      setAccountRanking(cached.accountRanking || []);
      setLastUpdated(new Date(cached.timestamp));
    }
    fetchData();
  }, []);

  const todayChange = useMemo(() => {
    if (
      !coreMetrics?.today ||
      !coreMetrics?.yesterday ||
      coreMetrics.today.dataStatus === "partial" ||
      coreMetrics.yesterday.dataStatus === "partial" ||
      coreMetrics.yesterday.spend === 0
    )
      return null;
    return (
      ((coreMetrics.today.spend - coreMetrics.yesterday.spend) /
        coreMetrics.yesterday.spend) *
      100
    );
  }, [coreMetrics]);

  const isPositiveChange = todayChange !== null && todayChange >= 0;
  const hasPartialData =
    coreMetrics?.today?.dataStatus === "partial" ||
    coreMetrics?.yesterday?.dataStatus === "partial" ||
    coreMetrics?.sevenDays?.dataStatus === "partial" ||
    trendData.some((day) => day?.dataStatus === "partial");
  const partialCoverage =
    coreMetrics?.today?.dataStatus === "partial"
      ? { label: "今日", unit: "个账户", value: coreMetrics.today.coverage }
      : coreMetrics?.sevenDays?.dataStatus === "partial"
        ? {
            label: "最近 7 天",
            unit: "条账户日记录",
            value: coreMetrics.sevenDays.coverage,
          }
        : null;
  const coverageMessage =
    partialCoverage?.value?.completeCohort === true && partialCoverage.value.tracked > 0
      ? `数据为部分覆盖：${partialCoverage.label}已确认 ${partialCoverage.value.usable}/${partialCoverage.value.tracked} ${partialCoverage.unit}（${partialCoverage.value.usableRate.toFixed(1)}%）。当前金额是数据库已保存的小计，未覆盖账户保持未知，不按 0 计算。`
      : "数据为部分覆盖。当前金额是数据库已保存的小计，未覆盖账户保持未知，不按 0 计算。";
  const updatedText = lastUpdated
    ? lastUpdated.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "等待同步";

  return (
    <div className="min-h-[100dvh] px-4 py-5 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <header className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_22px_55px_-42px_rgba(24,24,27,0.78)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-lg bg-[#edf4f1] px-3 py-2 text-xs font-bold text-[#0f766e]">
              <Pulse size={15} weight="fill" />
              实时聚合
            </div>
            <h1 className="text-4xl font-extrabold leading-none text-zinc-950 md:text-5xl">
              经营仪表盘
            </h1>
            <p className="mt-4 max-w-[62ch] text-sm leading-6 text-zinc-600">
              最近 7
              天的账户、广告系列和素材表现。数据来自预聚合表，适合日常巡检和快速判断。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg border border-zinc-200 bg-[#fbfbf8] px-3 py-2 font-mono text-xs font-bold text-zinc-600">
              {updatedText}
            </span>
            <button
              type="button"
              onClick={fetchData}
              disabled={isRefreshing}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-extrabold text-white shadow-[0_18px_34px_-24px_rgba(24,24,27,0.95)] hover:bg-zinc-800 active:translate-y-px"
            >
              <ArrowClockwise
                size={17}
                className={isRefreshing ? "animate-spin" : ""}
              />
              {isRefreshing ? "刷新中" : "刷新"}
            </button>
          </div>
        </header>
        {loadError && (
          <div className="rounded-lg border border-[#fecdd3] bg-[#fff1f2] px-4 py-3 text-sm font-bold text-[#b4233a]">
            {loadError}
          </div>
        )}
        {hasPartialData && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
            {coverageMessage}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label={
              coreMetrics?.today?.dataStatus === "partial"
                ? "今日已确认消耗"
                : "今日消耗"
            }
            value={
              coreMetrics?.today
                ? formatCurrency(coreMetrics.today.spend)
                : "--"
            }
            detail={
              todayChange === null
                ? "缺少可比数据"
                : `${todayChange.toFixed(1)}% vs 昨日`
            }
            tone={
              todayChange === null
                ? "default"
                : isPositiveChange
                  ? "negative"
                  : "positive"
            }
            icon={<CurrencyDollar size={21} weight="bold" />}
          />
          <MetricTile
            label={
              coreMetrics?.yesterday?.dataStatus === "partial"
                ? "昨日已确认消耗"
                : "昨日消耗"
            }
            value={
              coreMetrics?.yesterday
                ? formatCurrency(coreMetrics.yesterday.spend)
                : "--"
            }
            detail={coreMetrics?.yesterday ? "对比基线" : "等待有效数据"}
            icon={<Wallet size={21} weight="bold" />}
          />
          <MetricTile
            label={
              coreMetrics?.sevenDays?.dataStatus === "partial"
                ? "7 日已确认消耗"
                : "7 日总消耗"
            }
            value={
              coreMetrics?.sevenDays
                ? formatCurrency(coreMetrics.sevenDays.spend)
                : "--"
            }
            detail={
              coreMetrics?.sevenDays
                ? `日均 ${formatCurrency(coreMetrics.sevenDays.avgDailySpend)}`
                : "等待有效数据"
            }
            icon={<ChartLineUp size={21} weight="bold" />}
          />
          <MetricTile
            label={
              coreMetrics?.today?.dataStatus === "partial"
                ? "今日已确认 ROAS"
                : "今日 ROAS"
            }
            value={
              coreMetrics?.today
                ? formatDecimal(coreMetrics.today.roas)
                : "--"
            }
            detail={
              todayChange === null
                ? "等待有效数据"
                : isPositiveChange
                  ? "消耗走高"
                  : "消耗回落"
            }
            tone={
              todayChange === null
                ? "default"
                : isPositiveChange
                  ? "negative"
                  : "positive"
            }
            icon={
              isPositiveChange ? (
                <TrendUp size={21} weight="bold" />
              ) : (
                <TrendDown size={21} weight="bold" />
              )
            }
          />
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-extrabold text-zinc-950">
                  消耗趋势
                </h2>
                <p className="mt-1 text-sm text-zinc-500">按天聚合，美元口径</p>
              </div>
              <span className="font-mono text-xs font-bold text-zinc-500">
                7D
              </span>
            </div>
            <MiniLineChart
              data={trendData}
              valueKey="totalSpend"
              color="#18181b"
              valueLabel="消耗"
              formatValue={formatCurrency}
            />
          </article>

          <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-[0_18px_38px_-34px_rgba(24,24,27,0.72)]">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-extrabold text-zinc-950">
                  ROAS 趋势
                </h2>
                <p className="mt-1 text-sm text-zinc-500">同周期表现变化</p>
              </div>
              <span className="font-mono text-xs font-bold text-zinc-500">
                7D
              </span>
            </div>
            <MiniLineChart
              data={trendData}
              valueKey="roas"
              color="#0f766e"
              valueLabel="ROAS"
              formatValue={formatDecimal}
            />
          </article>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <BarList
            title="广告系列消耗排行"
            data={campaignRanking}
            nameKey="campaignName"
          />
          <BarList
            title="账户消耗排行"
            data={accountRanking}
            nameKey="accountName"
          />
        </section>
      </div>
    </div>
  );
}
