import { useEffect, useMemo, useState, type ReactNode } from "react";
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
} from "../services/api";

const getCacheKey = () => "dashboard_7days";

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
}: {
  data: any[];
  valueKey: string;
  color: string;
}) {
  const values = data.map((item) =>
    Number(item[valueKey] || item.totalSpend || item.spend || 0),
  );
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 84 - 8;
      return `${x},${y}`;
    })
    .join("");

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-[#fbfbf8] text-sm font-semibold text-zinc-500">
        暂无趋势数据
      </div>
    );
  }

  return (
    <div className="h-64 rounded-lg border border-zinc-200 bg-[#fbfbf8] p-4">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-48 w-full overflow-visible"
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
      </svg>
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
  const [coreMetrics, setCoreMetrics] = useState<any>(null);
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
    }
    fetchData();
  }, []);

  const todayChange = useMemo(() => {
    if (
      !coreMetrics?.today ||
      !coreMetrics?.yesterday ||
      coreMetrics.yesterday.spend === 0
    )
      return 0;
    return (
      ((coreMetrics.today.spend - coreMetrics.yesterday.spend) /
        coreMetrics.yesterday.spend) *
      100
    );
  }, [coreMetrics]);

  const isPositiveChange = todayChange >= 0;
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

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            label="今日消耗"
            value={formatCurrency(coreMetrics?.today?.spend || 0)}
            detail={`${todayChange.toFixed(1)}% vs 昨日`}
            tone={isPositiveChange ? "negative" : "positive"}
            icon={<CurrencyDollar size={21} weight="bold" />}
          />
          <MetricTile
            label="昨日消耗"
            value={formatCurrency(coreMetrics?.yesterday?.spend || 0)}
            detail="对比基线"
            icon={<Wallet size={21} weight="bold" />}
          />
          <MetricTile
            label="7 日总消耗"
            value={formatCurrency(coreMetrics?.sevenDays?.spend || 0)}
            detail={`日均 ${formatCurrency(coreMetrics?.sevenDays?.avgDailySpend || 0)}`}
            icon={<ChartLineUp size={21} weight="bold" />}
          />
          <MetricTile
            label="今日 ROAS"
            value={formatDecimal(coreMetrics?.today?.roas || 0)}
            detail={isPositiveChange ? "消耗走高" : "消耗回落"}
            tone={isPositiveChange ? "negative" : "positive"}
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
            <MiniLineChart data={trendData} valueKey="roas" color="#0f766e" />
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
