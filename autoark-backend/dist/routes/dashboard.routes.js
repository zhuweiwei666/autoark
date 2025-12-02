"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboardController = __importStar(require("../controllers/dashboard.controller"));
const router = (0, express_1.Router)();
// Analytics
router.get('/daily', dashboardController.getDaily);
router.get('/by-country', dashboardController.getByCountry);
router.get('/by-adset', dashboardController.getByAdSet);
// API: /dashboard/api/xxx (mounted at /dashboard in app.ts, so /api/health becomes /dashboard/api/health)
router.get('/api/health', dashboardController.getSystemHealthHandler);
router.get('/api/facebook-overview', dashboardController.getFacebookOverviewHandler);
router.get('/api/cron-logs', dashboardController.getCronLogsHandler);
router.get('/api/ops-logs', dashboardController.getOpsLogsHandler);
// 数据看板 V1 API
router.get('/api/core-metrics', dashboardController.getCoreMetricsHandler);
router.get('/api/today-spend-trend', dashboardController.getTodaySpendTrendHandler);
router.get('/api/campaign-spend-ranking', dashboardController.getCampaignSpendRankingHandler);
router.get('/api/country-spend-ranking', dashboardController.getCountrySpendRankingHandler);
// Dashboard UI (GET /dashboard)
// Mounted at /dashboard in app.ts, so '/' becomes '/dashboard'
router.get('/', (_req, res) => {
    // 确保设置正确的 Content-Type
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AutoArk Dashboard V0.1</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    /* Custom styles for active menu item */
    .menu-active {
      background-color: rgba(30, 41, 59, 0.5); /* slate-800/50 */
      border-color: rgba(100, 116, 139, 0.5); /* slate-700/50 */
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100">
  <div class="flex h-screen overflow-hidden">
    <!-- Left Sidebar Menu -->
    <aside class="w-64 bg-slate-900/80 border-r border-slate-800 flex flex-col">
      <!-- Logo -->
      <div class="p-4 border-b border-slate-800">
        <h1 class="text-xl font-bold text-slate-100">AutoArk</h1>
        <span class="text-xs text-slate-400">V0.1</span>
      </div>
      
      <!-- Menu Items -->
      <nav class="flex-1 p-4 space-y-2">
        <button 
          onclick="switchView('dashboard')" 
          id="menu-dashboard"
          class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-slate-200 hover:text-slate-100 hover:bg-slate-800/50 flex items-center gap-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75h2.25A2.25 2.25 0 018.25 18v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V15.75zM13.5 6h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H13.5A2.25 2.25 0 0111.25 18V8.25a2.25 2.25 0 012.25-2.25z" /></svg>
          <span>仪表盘</span>
        </button>
        <button 
          onclick="switchView('token')" 
          id="menu-token"
          class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-slate-200 hover:text-slate-100 hover:bg-slate-800/50 flex items-center gap-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 9z" /></svg>
          <span>Token 管理</span>
        </button>
        <button 
          onclick="switchView('accounts')" 
          id="menu-accounts"
          class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-slate-200 hover:text-slate-100 hover:bg-slate-800/50 flex items-center gap-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 21v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2m16-11V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16M14 10h.01M17 10h.01M9 10h.01M12 10h.01m2 2h.01M17 14h.01M9 14h.01M12 14h.01m2 2h.01M17 18h.01M9 18h.01M12 18h.01m-2-12h.01M7 12h.01m-2-12h.01M17 12h.01M9 12h.01m4-4h.01M7 16h.01M14 16h.01M14 20h.01M7 20h.01M9 16h.01M14 20h.01M7 20h.01"></path>
          </svg>
          <span>账户管理</span>
        </button>
        <button 
          onclick="switchView('campaigns')" 
          id="menu-campaigns"
          class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-slate-200 hover:text-slate-100 hover:bg-slate-800/50 flex items-center gap-3"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.497l4.875-2.437c.381-.194.62-.57.62-.981V9.75M8.25 19.5l-1.5-1.5m-3.75 3.75h15M11.25 4.5l-1.5-1.5M1.5 13.5l1.5-1.5m1.5 2.25l-1.5-1.5m-1.5 2.25l-1.5-1.5" /></svg>
          <span>广告系列</span>
        </button>
      </nav>
      
      <!-- Health Badge -->
      <div class="p-4 border-t border-slate-800">
        <span id="health-badge" class="text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-300 block text-center">Loading...</span>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 overflow-y-auto">
      <!-- Dashboard View -->
      <div id="view-dashboard" class="h-full p-6 space-y-6 overflow-y-auto">
        <header class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-slate-100">Dashboard</h2>
        </header>

    <!-- 数据看板 V1 - 核心指标卡片 -->
    <section class="bg-slate-900/70 rounded-xl border border-slate-800 p-6">
      <h2 class="text-xl font-bold text-slate-100 mb-4">📊 数据看板</h2>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6" id="core-metrics-cards">
        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <div class="text-xs text-slate-400 mb-1">今日消耗</div>
          <div class="text-2xl font-bold text-slate-100" id="today-spend">$0.00</div>
          <div class="text-xs text-slate-500 mt-1" id="today-spend-change">-</div>
        </div>
        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <div class="text-xs text-slate-400 mb-1">昨日消耗</div>
          <div class="text-2xl font-bold text-slate-100" id="yesterday-spend">$0.00</div>
        </div>
        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <div class="text-xs text-slate-400 mb-1">7日总消耗</div>
          <div class="text-2xl font-bold text-slate-100" id="seven-days-spend">$0.00</div>
          <div class="text-xs text-slate-500 mt-1" id="seven-days-avg">日均: $0.00</div>
        </div>
        <div class="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <div class="text-xs text-slate-400 mb-1">今日 ROAS</div>
          <div class="text-2xl font-bold text-slate-100" id="today-roas">0.00</div>
        </div>
      </div>

      <!-- 图表区域 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- 今日消耗趋势图 -->
        <div class="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 class="text-sm font-semibold text-slate-200 mb-4">今日消耗趋势（近7天）</h3>
          <canvas id="spend-trend-chart" height="200"></canvas>
        </div>

        <!-- 分 Campaign 消耗排行 -->
        <div class="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 class="text-sm font-semibold text-slate-200 mb-4">Campaign 消耗排行（Top 10）</h3>
          <canvas id="campaign-ranking-chart" height="200"></canvas>
        </div>
      </div>

      <!-- 分国家消耗排行 -->
      <div class="mt-6 bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
        <h3 class="text-sm font-semibold text-slate-200 mb-4">账户消耗排行（Top 10）</h3>
        <canvas id="country-ranking-chart" height="150"></canvas>
      </div>
    </section>

    <section class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <!-- System Health -->
      <div class="bg-slate-900/70 rounded-xl border border-slate-800 p-4 space-y-2">
        <h2 class="font-semibold text-sm text-slate-200">System Health</h2>
        <dl class="text-xs space-y-1" id="system-health">
          <div><dt class="inline text-slate-400">Server Time:</dt> <dd class="inline" data-field="serverTime">-</dd></div>
          <div><dt class="inline text-slate-400">Uptime:</dt> <dd class="inline" data-field="uptime">-</dd></div>
          <div><dt class="inline text-slate-400">Mongo:</dt> <dd class="inline" data-field="mongoConnected">-</dd></div>
          <div><dt class="inline text-slate-400">Last Sync:</dt> <dd class="inline" data-field="lastSyncAt">-</dd></div>
        </dl>
      </div>

      <!-- Facebook Overview -->
      <div class="bg-slate-900/70 rounded-xl border border-slate-800 p-4 space-y-2">
        <h2 class="font-semibold text-sm text-slate-200">Facebook Overview</h2>
        <dl class="text-xs space-y-1" id="fb-overview">
          <div><dt class="inline text-slate-400">Accounts:</dt> <dd class="inline" data-field="accounts">-</dd></div>
          <div><dt class="inline text-slate-400">Campaigns:</dt> <dd class="inline" data-field="campaigns">-</dd></div>
          <div><dt class="inline text-slate-400">Ads:</dt> <dd class="inline" data-field="ads">-</dd></div>
          <div><dt class="inline text-slate-400">Last Sync:</dt> <dd class="inline" data-field="lastSyncAt">-</dd></div>
        </dl>
      </div>
    </section>

    <!-- Cron Logs -->
    <section class="bg-slate-900/70 rounded-xl border border-slate-800 p-4">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold text-sm text-slate-200">Cron / Sync Logs</h2>
        <span class="text-[10px] text-slate-500">latest 50</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left border-collapse" id="cron-table">
          <thead class="bg-slate-900/90 text-slate-400">
            <tr>
              <th class="px-2 py-1 border-b border-slate-800">Time</th>
              <th class="px-2 py-1 border-b border-slate-800">Job</th>
              <th class="px-2 py-1 border-b border-slate-800">Status</th>
              <th class="px-2 py-1 border-b border-slate-800">Message</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800" id="cron-body">
            <tr><td class="px-2 py-2 text-slate-500" colspan="4">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Ops Logs -->
    <section class="bg-slate-900/70 rounded-xl border border-slate-800 p-4">
      <div class="flex items-center justify-between mb-2">
        <h2 class="font-semibold text-sm text-slate-200">Rules / Ops Logs</h2>
        <span class="text-[10px] text-slate-500">latest 50</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left border-collapse" id="ops-table">
          <thead class="bg-slate-900/90 text-slate-400">
            <tr>
              <th class="px-2 py-1 border-b border-slate-800">Time</th>
              <th class="px-2 py-1 border-b border-slate-800">Action</th>
              <th class="px-2 py-1 border-b border-slate-800">Target</th>
              <th class="px-2 py-1 border-b border-slate-800">Detail</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800" id="ops-body">
            <tr><td class="px-2 py-2 text-slate-500" colspan="4">Loading...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
      </div>

      <!-- Token Management View -->
      <div id="view-token" class="h-full hidden">
        <iframe 
          src="/fb-token" 
          class="w-full h-full border-0"
          title="Token Management"
        ></iframe>
      </div>

      <!-- Accounts Management View -->
      <div id="view-accounts" class="h-full hidden">
        <iframe 
          src="/fb-accounts" 
          class="w-full h-full border-0"
          title="Accounts Management"
        ></iframe>
      </div>

      <!-- Campaigns Management View -->
      <div id="view-campaigns" class="h-full hidden">
        <iframe 
          src="/fb-campaigns" 
          class="w-full h-full border-0"
          title="Campaigns Management"
        ></iframe>
      </div>
    </main>
  </div>

  <script>
    // View switching function
    function switchView(viewName) {
      // Hide all views
      document.querySelectorAll('[id^="view-"]').forEach(view => {
        view.classList.add('hidden')
      })
      
      // Show selected view
      const selectedView = document.getElementById('view-' + viewName)
      if (selectedView) {
        selectedView.classList.remove('hidden')
      }
      
      // Update menu active state
      document.querySelectorAll('[id^="menu-"]').forEach(btn => {
        btn.classList.remove('bg-slate-800/30', 'border', 'border-slate-700/50')
        btn.classList.add('bg-transparent')
      })
      
      const activeBtn = document.getElementById('menu-' + viewName)
      if (activeBtn) {
        activeBtn.classList.add('bg-slate-800/30', 'border', 'border-slate-700/50')
        activeBtn.classList.remove('bg-transparent')
      }
    }
    
    // Initialize: show dashboard by default
    switchView('dashboard')

    // Format functions
    function formatTime(value) {
      if (!value) return '-'
      try {
        const d = new Date(value)
        if (isNaN(d.getTime())) return value
        return d.toLocaleString()
      } catch (e) {
        return value
      }
    }

    function formatDuration(seconds) {
      const s = Math.floor(seconds || 0)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const r = Math.floor(s % 60)
      return h + 'h ' + m + 'm ' + r + 's'
    }

    async function fetchJSON(url) {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Request failed: ' + res.status)
      return res.json()
    }

    // API endpoints are mounted at /api/dashboard, so use absolute paths
    const API_BASE = '/api/dashboard'
    
    async function loadSystemHealth() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/health') 
        
        const root = document.getElementById('system-health')
        root.querySelector('[data-field="serverTime"]').textContent = formatTime(data.serverTime)
        root.querySelector('[data-field="uptime"]').textContent = formatDuration(data.uptimeSeconds)
        root.querySelector('[data-field="mongoConnected"]').textContent = data.mongoConnected ? 'CONNECTED' : 'DISCONNECTED'
        root.querySelector('[data-field="lastSyncAt"]').textContent = formatTime(data.lastSyncAt)

        const badge = document.getElementById('health-badge')
        if (data.mongoConnected) {
          badge.textContent = 'Healthy'
          badge.classList.remove('bg-red-900/60', 'text-red-300')
          badge.classList.add('bg-emerald-900/60', 'text-emerald-300')
        } else {
          badge.textContent = 'Degraded'
          badge.classList.remove('bg-emerald-900/60', 'text-emerald-300')
          badge.classList.add('bg-red-900/60', 'text-red-300')
        }
      } catch (e) {
        console.error('Health check failed', e)
        const badge = document.getElementById('health-badge')
        badge.textContent = 'Error'
        badge.classList.add('bg-red-900/60', 'text-red-300')
      }
    }

    async function loadFacebookOverview() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/facebook-overview')
        const root = document.getElementById('fb-overview')
        root.querySelector('[data-field="accounts"]').textContent = data.accounts
        root.querySelector('[data-field="campaigns"]').textContent = data.campaigns
        root.querySelector('[data-field="ads"]').textContent = data.ads
        root.querySelector('[data-field="lastSyncAt"]').textContent = formatTime(data.lastSyncAt)
      } catch (e) {
        console.error(e)
      }
    }

    function renderCronLogs(logs) {
      const tbody = document.getElementById('cron-body')
      tbody.innerHTML = ''
      if (!logs.length) {
        tbody.innerHTML = '<tr><td class="px-2 py-2 text-slate-500" colspan="4">No logs</td></tr>'
        return
      }
      logs.forEach((log) => {
        const tr = document.createElement('tr')
        tr.innerHTML = '<td class="px-2 py-1 text-slate-300">' + formatTime(log.createdAt || log.startedAt) + '</td>' +
          '<td class="px-2 py-1 text-slate-300">' + (log.jobName || log.job || 'Sync') + '</td>' +
          '<td class="px-2 py-1">' + (log.status || '-') + '</td>' +
          '<td class="px-2 py-1 text-slate-400 max-w-xs truncate">' + (log.message || log.error || JSON.stringify(log.details) || '-') + '</td>'
        tbody.appendChild(tr)
      })
    }

    async function loadCronLogs() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/cron-logs?limit=50')
        renderCronLogs(data || [])
      } catch (e) {
        console.error(e)
      }
    }

    function renderOpsLogs(logs) {
      const tbody = document.getElementById('ops-body')
      tbody.innerHTML = ''
      if (!logs.length) {
        tbody.innerHTML = '<tr><td class="px-2 py-2 text-slate-500" colspan="4">No logs</td></tr>'
        return
      }
      logs.forEach((log) => {
        const tr = document.createElement('tr')
        tr.innerHTML = '<td class="px-2 py-1 text-slate-300">' + formatTime(log.createdAt) + '</td>' +
          '<td class="px-2 py-1 text-slate-300">' + (log.action || '-') + '</td>' +
          '<td class="px-2 py-1 text-slate-300">' + (log.related && log.related.adId ? log.related.adId : '-') + '</td>' +
          '<td class="px-2 py-1 text-slate-400 max-w-xs truncate">' + (log.reason || '-') + '</td>'
        tbody.appendChild(tr)
      })
    }

    async function loadOpsLogs() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/ops-logs?limit=50')
        renderOpsLogs(data || [])
      } catch (e) {
        console.error(e)
      }
    }

    // ========== 数据看板 V1 ==========
    let spendTrendChart = null
    let campaignRankingChart = null
    let countryRankingChart = null

    async function loadCoreMetrics() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/core-metrics')
        
        // 更新核心指标卡片
        document.getElementById('today-spend').textContent = '$' + (data.today?.spend || 0).toFixed(2)
        document.getElementById('yesterday-spend').textContent = '$' + (data.yesterday?.spend || 0).toFixed(2)
        document.getElementById('seven-days-spend').textContent = '$' + (data.sevenDays?.spend || 0).toFixed(2)
        document.getElementById('seven-days-avg').textContent = '日均: $' + (data.sevenDays?.avgDailySpend || 0).toFixed(2)
        document.getElementById('today-roas').textContent = (data.today?.roas || 0).toFixed(2)
        
        // 计算今日 vs 昨日变化
        const change = data.yesterday?.spend > 0 
          ? ((data.today?.spend - data.yesterday?.spend) / data.yesterday?.spend * 100).toFixed(1)
          : '0.0'
        const changeEl = document.getElementById('today-spend-change')
        changeEl.textContent = change + '% vs 昨日'
        changeEl.className = 'text-xs mt-1 ' + (parseFloat(change) >= 0 ? 'text-emerald-400' : 'text-red-400')
      } catch (e) {
        console.error('Failed to load core metrics', e)
      }
    }

    async function loadSpendTrend() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/today-spend-trend')
        
        const ctx = document.getElementById('spend-trend-chart')
        if (spendTrendChart) {
          spendTrendChart.destroy()
        }
        
        spendTrendChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: data.map(d => d.date),
            datasets: [{
              label: '消耗 ($)',
              data: data.map(d => d.spend || 0),
              borderColor: 'rgb(99, 102, 241)',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              tension: 0.4,
              fill: true,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: { color: '#cbd5e1' },
              },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
              y: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
            },
          },
        })
      } catch (e) {
        console.error('Failed to load spend trend', e)
      }
    }

    async function loadCampaignRanking() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/campaign-spend-ranking?limit=10')
        
        const ctx = document.getElementById('campaign-ranking-chart')
        if (campaignRankingChart) {
          campaignRankingChart.destroy()
        }
        
        campaignRankingChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: data.map(d => (d.campaignName || d.campaignId || 'Unknown').substring(0, 20)),
            datasets: [{
              label: '消耗 ($)',
              data: data.map(d => d.spend || 0),
              backgroundColor: 'rgba(99, 102, 241, 0.8)',
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: {
                labels: { color: '#cbd5e1' },
              },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
              y: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
            },
          },
        })
      } catch (e) {
        console.error('Failed to load campaign ranking', e)
      }
    }

    async function loadCountryRanking() {
      try {
        const { data } = await fetchJSON(API_BASE + '/api/country-spend-ranking?limit=10')
        
        const ctx = document.getElementById('country-ranking-chart')
        if (countryRankingChart) {
          countryRankingChart.destroy()
        }
        
        countryRankingChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: data.map(d => (d.accountName || d.accountId || 'Unknown').substring(0, 20)),
            datasets: [{
              label: '消耗 ($)',
              data: data.map(d => d.spend || 0),
              backgroundColor: 'rgba(16, 185, 129, 0.8)',
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
              legend: {
                labels: { color: '#cbd5e1' },
              },
            },
            scales: {
              x: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
              y: {
                ticks: { color: '#94a3b8' },
                grid: { color: 'rgba(148, 163, 184, 0.1)' },
              },
            },
          },
        })
      } catch (e) {
        console.error('Failed to load country ranking', e)
      }
    }

    async function loadDashboardData() {
      await Promise.all([
        loadCoreMetrics(),
        loadSpendTrend(),
        loadCampaignRanking(),
        loadCountryRanking(),
      ])
    }

    async function init() {
      await Promise.all([
        loadSystemHealth(),
        loadFacebookOverview(),
        loadCronLogs(),
        loadOpsLogs(),
        loadDashboardData(),
      ])
    }

    init()
    setInterval(init, 60000)
  </script>
</body>
</html>
  `);
});
exports.default = router;
