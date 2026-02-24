require("dotenv").config();
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

const BASE = "https://toptou.tec-do.com/phoenix/v1.0";
const TOKEN = process.env.TOPTOU_TOKEN;

async function post(path, data, extraHeaders = {}) {
  const r = await axios.post(BASE + path, data, {
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      accessToken: TOKEN,
      requestid: uuidv4(),
      ...extraHeaders,
    },
    timeout: 15000,
  });
  return r.data;
}

async function main() {
  // 1. 从 campaign list 拿 TopTou 内部 ID
  console.log("=== Step 1: 获取 campaign 列表，找 TopTou 内部 ID ===");
  const list = await post("/fb/list/campaign/campaign_list", { pageSize: 5, pageNum: 1 });
  for (const c of list.data.slice(0, 5)) {
    console.log(JSON.stringify({ toptouId: c.id, fbId: c.fbId || c.campaignId || c.facebookId, accountId: c.accountId, name: c.name, budget: c.daily_budget || c.budget || c.dailyBudget }));
    console.log("  All keys:", Object.keys(c).join(", "));
  }

  // 拿第一个 campaign 测试
  const camp = list.data[0];
  console.log("\nUsing campaign:", camp.name);
  console.log("TopTou ID:", camp.id, "(type:", typeof camp.id, ")");
  console.log("AccountId:", camp.accountId);

  // 2. 用 TopTou 内部 ID + 正确参数格式测试预算接口
  console.log("\n=== Step 2: 用 TopTou 内部 ID 测试 name-or-budget ===");
  try {
    const r = await post("/facebook/editor/name-or-budget", {
      id: camp.id,                    // TopTou 内部 ID
      accountId: camp.accountId,
      budgetMode: "DAY",
      budget: "50",                   // 字符串，美元
      currency: "USD",
      level: 1,
    });
    console.log("Result:", JSON.stringify(r));
  } catch (e) {
    console.log("ERR:", e.response?.data || e.message);
  }

  // 3. 不带 cookie 再试一次（对比）
  console.log("\n=== Step 3: 只改名测试 ===");
  try {
    const r = await post("/facebook/editor/name-or-budget", {
      id: camp.id,
      accountId: camp.accountId,
      name: camp.name,  // 改回原名（等于没改）
      level: 1,
    });
    console.log("Result:", JSON.stringify(r));
  } catch (e) {
    console.log("ERR:", e.response?.data || e.message);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
