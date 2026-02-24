require("dotenv").config();
const axios = require("axios");
const mongoose = require("mongoose");

const BASE = "https://toptou.tec-do.com/phoenix/v1.0";
const TOKEN = process.env.TOPTOU_TOKEN;

async function main() {
  const campId = "120241280477810676";
  const acctId = "1617071489473004";

  // 1. 模拟浏览器前端请求（带 Origin/Referer）
  console.log("=== 1. 模拟前端浏览器请求 ===");
  try {
    const r = await axios.post(BASE + "/facebook/editor/name-or-budget",
      { level: 1, id: campId, accountId: acctId, daily_budget: 5000 },
      { headers: {
        "Content-Type": "application/json",
        accessToken: TOKEN,
        Origin: "https://toptou.tec-do.com",
        Referer: "https://toptou.tec-do.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
      }, timeout: 10000 }
    );
    console.log("Code:", r.data.code, "Msg:", r.data.msg);
  } catch (e) { console.log("ERR:", e.response?.data || e.message); }

  // 2. 尝试 Facebook Marketing API 直接调用
  console.log("\n=== 2. 检查 Facebook token 可用性 ===");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // 检查所有可能有 token 的集合
  const cols = await db.listCollections().toArray();
  const tokenCols = cols.filter(c =>
    c.name.includes("token") || c.name.includes("Token") ||
    c.name.includes("account") || c.name.includes("Account")
  );
  console.log("Relevant collections:", tokenCols.map(c => c.name));

  for (const tc of tokenCols) {
    const docs = await db.collection(tc.name).find().limit(3).toArray();
    if (docs.length > 0) {
      console.log("\n" + tc.name + ": " + docs.length + " docs");
      for (const d of docs) {
        const keys = Object.keys(d).filter(k => k !== "_id" && k !== "__v");
        console.log("  keys:", keys.join(", "));
        if (d.accessToken) console.log("  hasToken: YES, preview:", d.accessToken.substring(0, 20) + "...");
        if (d.platform) console.log("  platform:", d.platform);
        if (d.status) console.log("  status:", d.status);
      }
    }
  }

  // 3. 检查 env 有没有 FB 相关变量
  console.log("\n=== 3. ENV 检查 ===");
  const relevant = Object.keys(process.env).filter(k =>
    k.includes("FB") || k.includes("FACEBOOK") ||
    k.includes("TOPTOU") || k.includes("GRAPH")
  );
  for (const k of relevant) {
    const v = process.env[k] || "";
    console.log(k + ":", v.length > 30 ? v.substring(0, 30) + "..." : v);
  }

  // 4. 直接测试 Facebook Graph API（如果有 token）
  console.log("\n=== 4. Facebook Graph API 直连测试 ===");
  // 尝试用 campaign ID 直接调 FB
  try {
    // 这个 campaign ID 是 FB 格式的，试试直接 GET
    const fbUrl = `https://graph.facebook.com/v21.0/${campId}?fields=daily_budget,name,status&access_token=placeholder`;
    console.log("FB API URL (need real token):", fbUrl.replace("placeholder", "TOKEN"));
    console.log("如果有 Facebook System User token, 可直接调 Graph API 修改预算");
  } catch (e) { console.log("ERR:", e.message); }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
