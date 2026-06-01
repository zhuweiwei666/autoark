import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  AppWindow,
  Buildings,
  CaretDown,
  ChartLineUp,
  ChatCircleText,
  CheckSquareOffset,
  ClipboardText,
  Database,
  FolderOpen,
  GlobeHemisphereWest,
  ImageSquare,
  Key,
  Lightning,
  List,
  Megaphone,
  Pulse,
  Robot,
  SignOut,
  Stack,
  UserGear,
  UsersThree,
} from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import {
  getAccounts,
  getCampaigns,
  getCommercialReadiness,
  getCountries,
  getMaterialRankings,
} from "../services/api";
import { useAuth } from "../contexts/AuthContext";

interface LayoutProps {
  children: ReactNode;
}

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  prefetch?: () => void;
  superAdminOnly?: boolean;
  adminOnly?: boolean;
};

type NavSection = {
  id: string;
  title: string;
  marker?: string;
  items: NavItem[];
};

const roleLabel: Record<string, string> = {
  super_admin: "超级管理员",
  org_admin: "组织管理员",
  member: "成员",
};

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { user, logout, isSuperAdmin, isOrgAdmin } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    intelligence: true,
    publish: true,
    agent: false,
    system: false,
  });

  const prefetchConfig: Record<string, () => void> = {
    "/fb-accounts": () => {
      queryClient.prefetchQuery({
        queryKey: [
          "accounts",
          { page: 1, limit: 20, sortBy: "periodSpend", sortOrder: "desc" },
        ],
        queryFn: () =>
          getAccounts({
            page: 1,
            limit: 20,
            sortBy: "periodSpend",
            sortOrder: "desc",
          }),
      });
    },
    "/commercial": () => {
      queryClient.prefetchQuery({
        queryKey: ["commercial-readiness"],
        queryFn: () => getCommercialReadiness(),
      });
    },
    "/fb-campaigns": () => {
      queryClient.prefetchQuery({
        queryKey: [
          "campaigns",
          { page: 1, limit: 20, sortBy: "spend", sortOrder: "desc" },
        ],
        queryFn: () =>
          getCampaigns({
            page: 1,
            limit: 20,
            sortBy: "spend",
            sortOrder: "desc",
          }),
      });
    },
    "/fb-countries": () => {
      queryClient.prefetchQuery({
        queryKey: [
          "countries",
          { page: 1, limit: 20, sortBy: "spend", sortOrder: "desc" },
        ],
        queryFn: () =>
          getCountries({
            page: 1,
            limit: 20,
            sortBy: "spend",
            sortOrder: "desc",
          }),
      });
    },
    "/fb-materials": () => {
      queryClient.prefetchQuery({
        queryKey: ["materialRankings", {}],
        queryFn: () => getMaterialRankings({}),
      });
    },
  };

  const sections: NavSection[] = [
    {
      id: "intelligence",
      title: "经营视图",
      items: [
        { to: "/dashboard", label: "仪表盘", icon: AppWindow },
        {
          to: "/commercial",
          label: "商用中心",
          icon: Lightning,
          prefetch: prefetchConfig["/commercial"],
        },
        {
          to: "/fb-accounts",
          label: "账户管理",
          icon: UsersThree,
          prefetch: prefetchConfig["/fb-accounts"],
        },
        {
          to: "/fb-countries",
          label: "国家表现",
          icon: GlobeHemisphereWest,
          prefetch: prefetchConfig["/fb-countries"],
        },
        {
          to: "/fb-campaigns",
          label: "广告系列",
          icon: ChartLineUp,
          prefetch: prefetchConfig["/fb-campaigns"],
        },
        {
          to: "/fb-materials",
          label: "素材数据",
          icon: ImageSquare,
          prefetch: prefetchConfig["/fb-materials"],
          superAdminOnly: true,
        },
        { to: "/fb-settings", label: "Token 与像素", icon: Key },
        { to: "/fb-apps", label: "App 管理", icon: Stack, superAdminOnly: true },
      ],
    },
    {
      id: "publish",
      title: "投放工作台",
      marker: "批量",
      items: [
        { to: "/bulk-ad/create", label: "创建广告", icon: Megaphone },
        { to: "/bulk-ad/tasks", label: "任务管理", icon: ClipboardText },
        { to: "/bulk-ad/review", label: "审核状态", icon: CheckSquareOffset },
        { to: "/bulk-ad/assets", label: "资产管理", icon: Database },
        { to: "/bulk-ad/materials", label: "素材库", icon: FolderOpen },
      ],
    },
    {
      id: "agent",
      title: "Agent",
      items: [
        { to: "/ai/chat", label: "对话", icon: ChatCircleText, superAdminOnly: true },
        { to: "/ai/agents", label: "Agent 管理", icon: Robot, superAdminOnly: true },
        { to: "/ai/automation-jobs", label: "自动化任务", icon: Lightning, superAdminOnly: true },
      ],
    },
    {
      id: "system",
      title: "系统",
      items: [
        { to: "/users", label: "用户管理", icon: UserGear, adminOnly: true },
        { to: "/audit-logs", label: "审计日志", icon: ClipboardText, adminOnly: true },
        {
          to: "/organizations",
          label: "组织管理",
          icon: Buildings,
          superAdminOnly: true,
        },
        {
          to: "/account-pool",
          label: "账户池",
          icon: Database,
          superAdminOnly: true,
        },
      ],
    },
  ];

  const visibleSections = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.superAdminOnly) return isSuperAdmin;
        if (item.adminOnly) return isSuperAdmin || isOrgAdmin;
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);

  const toggleSection = (section: string) => {
    setExpandedSections((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  };

  const isActive = (path: string) => location.pathname === path;

  const NavLink = ({ item }: { item: NavItem }) => {
    const Icon = item.icon;
    const active = isActive(item.to);

    return (
      <Link
        to={item.to}
        onClick={() => setMobileOpen(false)}
        onMouseEnter={item.prefetch}
        className={[
          "menu-item group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold",
          active
            ? "active bg-zinc-900 text-white shadow-[0_16px_30px_-24px_rgba(24,24,27,0.9)]"
            : "text-zinc-600 hover:bg-white hover:text-zinc-950",
        ].join("")}
      >
        <Icon
          size={19}
          weight={active ? "fill" : "regular"}
          className={
            active ? "text-white" : "text-zinc-500 group-hover:text-zinc-950"
          }
        />
        <span className="min-w-0 truncate">{item.label}</span>
      </Link>
    );
  };

  const Navigation = () => (
    <nav className="space-y-3 px-3 py-4">
      {visibleSections.map((section) => {
        const open = expandedSections[section.id];
        return (
          <section key={section.id}>
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            >
              <span className="flex items-center gap-2">
                {section.marker && (
                  <span className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-zinc-600">
                    {section.marker}
                  </span>
                )}
                {section.title}
              </span>
              <CaretDown
                size={14}
                className={open ? "rotate-180 text-zinc-900" : "text-zinc-400"}
              />
            </button>
            {open && (
              <div className="mt-1 space-y-1 animate-accordion-down">
                {section.items.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] bg-[#f5f7f5] text-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-[#f5f7f5]/90 backdrop-blur lg:hidden">
        <div className="flex h-16 items-center justify-between px-4">
          <Link to="/dashboard" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-950 text-white">
              <Pulse size={18} weight="fill" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-zinc-950">
                AutoArk
              </div>
              <div className="text-xs text-zinc-500">Ad operations</div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((value) => !value)}
            className="rounded-lg border border-zinc-300 bg-white p-2 text-zinc-900"
            aria-label="切换导航"
          >
            <List size={20} />
          </button>
        </div>
        {mobileOpen && (
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-zinc-200 bg-[#f5f7f5]">
            <Navigation />
          </div>
        )}
      </header>

      <div className="grid min-h-[100dvh] lg:grid-cols-[272px_minmax(0,1fr)]">
        <aside className="hidden border-r border-zinc-200 bg-[#f5f7f5]/96 lg:flex lg:flex-col">
          <div className="border-b border-zinc-200 px-5 py-5">
            <Link to="/dashboard" className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-[0_18px_36px_-26px_rgba(24,24,27,0.9)]">
                <Pulse size={22} weight="fill" />
              </div>
              <div>
                <div className="text-lg font-extrabold text-zinc-950">
                  AutoArk
                </div>
                <div className="text-xs font-semibold text-zinc-500">
                  Ad operations
                </div>
              </div>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto app-scroll">
            <Navigation />
          </div>

          <div className="border-t border-zinc-200 p-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-[0_16px_30px_-28px_rgba(24,24,27,0.65)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e7f3ef] text-sm font-extrabold text-[#0f766e]">
                  {(user?.username || "A").slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-zinc-950">
                    {user?.username}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {user?.email}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700">
                  {roleLabel[user?.role || "member"]}
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold text-[#b4233a] hover:bg-[#fff1f2]"
                >
                  <SignOut size={15} />
                  退出
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 px-2 text-xs font-semibold text-zinc-500">
              <span className="h-2 w-2 rounded-full bg-[#15803d]" />
              系统在线
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <div className="h-full overflow-y-auto app-scroll">
            <div key={location.pathname} className="animate-fade-in">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
