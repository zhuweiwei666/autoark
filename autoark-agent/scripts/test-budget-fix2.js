require("dotenv").config();
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const BASE = "https://toptou.tec-do.com/phoenix/v1.0";
const TOKEN = process.env.TOPTOU_TOKEN;

async function post(path, data, extraHeaders = {}) {
  const r = await axios.post(BASE + path, data, {
    headers: { "Content-Type": "application/json;charset=UTF-8", accessToken: TOKEN, requestid: uuidv4(), ...extraHeaders },
    timeout: 15000,
  });
  return r.data;
}
async function get(path, params = {}) {
  const r = await axios.get(BASE + path, {
    headers: { accessToken: TOKEN }, params, timeout: 15000,
  });
  return r.data;
}

async function main() {
  // 1. 找一个能返回更多字段的 campaign 列表接口
  console.log("=== 寻找 TopTou 内部 ID ===");

  // 试试带更多参数的 campaign list
  const list = await post("/fb/list/campaign/campaign_list", {
    pageSize: 3, pageNum: 1, accountId: "1311173997482047"  // 用截图里的 accountId
  });
  console.log("List with accountId filter:");
  if (list.data) {
    for (const c of list.data.slice(0, 3)) {
      console.log("  All fields:", JSON.stringify(c));
    }
  }

  // 2. 试试获取 campaign 详情的不同接口
  console.log("\n=== campaign 详情接口 ===");
  const fbId = list.data?.[0]?.id || "120241280477810676";

  // 各种详情接口
  const detailEndpoints = [
    { path: "/fb/list/campaign/detail", method: "post", data: { id: fbId } },
    { path: "/fb/list/campaign/detail", method: "post", data: { campaignId: fbId } },
    { path: "/fb/campaign/detail", method: "get", data: { id: fbId } },
    { path: "/fb/campaign/get", method: "get", data: { campaignId: fbId } },
    { path: "/facebook/data/campaign/detail", method: "get", data: { id: fbId } },
    { path: "/fb/list/campaign/info", method: "post", data: { id: fbId } },
  ];

  for (const ep of detailEndpoints) {
    try {
      let r;
      if (ep.method === "post") r = await post(ep.path, ep.data);
      else r = await get(ep.path, ep.data);
      if (r.code === 200 && r.data) {
        console.log(ep.path + " → 200! Keys:", Object.keys(r.data).join(", "));
        console.log("  Data:", JSON.stringify(r.data).substring(0, 200));
      } else {
        console.log(ep.path + " →", r.code, r.msg);
      }
    } catch (e) {
      console.log(ep.path + " →", e.response?.status || "err");
    }
  }

  // 3. 直接用 Facebook ID 作为数字试试（虽然超大）
  console.log("\n=== 用 FB ID 测试 budget（各种 ID 格式） ===");
  const acctId = "1311173997482047";
  const tests = [
    { desc: "FB ID string", data: { id: fbId, accountId: acctId, budgetMode: "DAY", budget: "50", currency: "USD", level: 1 } },
    { desc: "FB ID number", data: { id: Number(fbId), accountId: acctId, budgetMode: "DAY", budget: "50", currency: "USD", level: 1 } },
    { desc: "campaignId field", data: { campaignId: fbId, accountId: acctId, budgetMode: "DAY", budget: "50", currency: "USD", level: 1 } },
  ];

  for (const t of tests) {
    try {
      const r = await post("/facebook/editor/name-or-budget", t.data);
      console.log(t.desc + " →", r.code, r.msg);
      if (r.code === 200) console.log("  SUCCESS! Data:", JSON.stringify(r.data));
    } catch (e) {
      console.log(t.desc + " → ERR:", e.response?.data?.msg || e.message);
    }
  }

  // 4. 检查 /fb/list/campaign/campaign_list 是否有分页接口返回更多字段
  console.log("\n=== 详细 campaign list（带 accountId）===");
  const detailedList = await post("/fb/list/campaign/campaign_list", {
    pageSize: 2, pageNum: 1, accountId: "1311173997482047",
    fields: ["id", "name", "daily_budget", "status", "effective_status"],
  });
  if (detailedList.data) {
    for (const c of (detailedList.data || []).slice(0, 2)) {
      console.log("All fields:", JSON.stringify(c));
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
