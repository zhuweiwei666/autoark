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
          class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-slate-200 hover:text-slate-100 hover:bg-slate-800/50 bg-slate-800/30 border border-slate-700/50 flex items-center gap-3"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
          </svg>
          <span>仪表盘</span>
        </button>
        <button 
          onclick="switchView('token')" 
          id="menu-token"
          class="w-full px-4 py-3 rounded-lg text-sm font-medium transition-colors text-slate-200 hover:text-slate-100 hover:bg-slate-800/50 flex items-center gap-3"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
          </svg>
          <span>Token 管理</span>
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
      <div id="view-dashboard" class="h-full p-6 space-y-6">
        <header class="flex items-center justify-between">
          <h2 class="text-2xl font-bold text-slate-100">Dashboard</h2>
        </header>

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
      const selectedView = document.getElementById(\`view-\${viewName}\`)
      if (selectedView) {
        selectedView.classList.remove('hidden')
      }
      
      // Update menu active state
      document.querySelectorAll('[id^="menu-"]').forEach(btn => {
        btn.classList.remove('bg-slate-800/30', 'border', 'border-slate-700/50')
        btn.classList.add('bg-transparent')
      })
      
      const activeBtn = document.getElementById(\`menu-\${viewName}\`)
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
      return \`\${h}h \${m}m \${r}s\`
    }

    async function fetchJSON(url) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(\`Request failed: \${res.status}\`)
      return res.json()
    }

    // API endpoints are mounted at /api/dashboard, so use absolute paths
    const API_BASE = '/api/dashboard'
    
    async function loadSystemHealth() {
      try {
        const { data } = await fetchJSON(\`\${API_BASE}/api/health\`) 
        
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
        const { data } = await fetchJSON(\`\${API_BASE}/api/facebook-overview\`)
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
        tr.innerHTML = \`
          <td class="px-2 py-1 text-slate-300">\${formatTime(log.createdAt || log.startedAt)}</td>
          <td class="px-2 py-1 text-slate-300">\${log.jobName || log.job || 'Sync'}</td>
          <td class="px-2 py-1">\${log.status || '-'}</td>
          <td class="px-2 py-1 text-slate-400 max-w-xs truncate">\${log.message || log.error || JSON.stringify(log.details) || '-'}</td>
        \`
        tbody.appendChild(tr)
      })
    }

    async function loadCronLogs() {
      try {
        const { data } = await fetchJSON(\`\${API_BASE}/api/cron-logs?limit=50\`)
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
        tr.innerHTML = \`
          <td class="px-2 py-1 text-slate-300">\${formatTime(log.createdAt)}</td>
          <td class="px-2 py-1 text-slate-300">\${log.action || '-'}</td>
          <td class="px-2 py-1 text-slate-300">\${log.related?.adId || '-'}</td>
          <td class="px-2 py-1 text-slate-400 max-w-xs truncate">\${log.reason || '-'}</td>
        \`
        tbody.appendChild(tr)
      })
    }

    async function loadOpsLogs() {
      try {
        const { data } = await fetchJSON(\`\${API_BASE}/api/ops-logs?limit=50\`)
        renderOpsLogs(data || [])
      } catch (e) {
        console.error(e)
      }
    }

    async function init() {
      await Promise.all([
        loadSystemHealth(),
        loadFacebookOverview(),
        loadCronLogs(),
        loadOpsLogs(),
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
