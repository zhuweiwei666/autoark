const { chromium } = require("playwright");
const axios = require("axios");

const TOPTOU_URL = "https://toptou.tec-do.com";
const BASE_API = "https://toptou.tec-do.com/phoenix/v1.0";
const EMAIL = "zhuweiwei@adcreative.cn";
const PASSWORD = "whez1107.";
const TEST_ACCOUNT = "1311173997482047";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, locale: "zh-CN",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  // 登录
  await page.goto(TOPTOU_URL + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.locator('text=我已阅读并同意').first().click();
  await page.waitForTimeout(300);
  await page.fill('input[placeholder="邮箱"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button:has-text("登录")');
  await page.waitForTimeout(5000);
  if (page.url().includes("login")) { console.log("FAILED"); return; }
  console.log("Login OK");

  // 导航到 campaign 页面
  await page.goto(TOPTOU_URL + "/adMange/facebook?t=campaign&accountId=" + TEST_ACCOUNT, {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await page.waitForTimeout(10000);

  // 提取 levelDataId（包含 campaign 内部 ID）
  console.log("\n=== 提取 levelDataId ===");
  const levelData = await page.evaluate(() => {
    const app = document.querySelector("#app")?.__vue_app__;
    const pinia = app?.config?.globalProperties?.$pinia;
    const fb = pinia?.state?.value?.facebook;
    if (!fb?.levelDataId) return { error: "no levelDataId" };

    const ld = fb.levelDataId;
    return {
      accountIds: ld.accountIds,
      campaignIds: ld.campaignIds,
      adSetIds: ld.adSetIds,
      campaignDataKeys: ld.campaignData ? Object.keys(ld.campaignData) : [],
      // 获取第一个 campaign 的完整数据
      firstCampaignKey: ld.campaignData ? Object.keys(ld.campaignData)[0] : null,
      firstCampaignData: ld.campaignData ? JSON.stringify(Object.values(ld.campaignData)[0])?.substring(0, 800) : null,
      campaignCount: ld.campaignData ? Object.keys(ld.campaignData).length : 0,
    };
  });
  console.log(JSON.stringify(levelData, null, 2));

  // 如果找到 campaign 数据，提取内部 ID 和预算
  if (levelData.firstCampaignData) {
    console.log("\n=== 解析 campaign 数据找内部 ID ===");
    const campData = JSON.parse(levelData.firstCampaignData);
    // 找所有包含 id 的字段
    const idFields = {};
    for (const [k, v] of Object.entries(campData)) {
      if (k.toLowerCase().includes("id") || k === "pk") idFields[k] = v;
    }
    console.log("ID fields:", JSON.stringify(idFields));
    console.log("Budget fields:", JSON.stringify({
      daily_budget: campData.daily_budget || campData.dailyBudget,
      budget: campData.budget,
      budgetMode: campData.budgetMode || campData.budget_mode,
    }));
    console.log("Name:", campData.name || campData.campaignName);
    console.log("Status:", campData.status || campData.configuredStatus);

    // 用找到的内部 ID 测试 budget API
    const internalId = campData.id || campData.pk || idFields.id;
    if (internalId) {
      console.log("\n=== 用内部 ID 测试 budget API ===");
      console.log("Internal ID:", internalId, "(type:", typeof internalId, ")");

      // 获取 cookies 和 token
      const cookies = await ctx.cookies();
      const cookieStr = cookies.map(c => c.name + "=" + c.value).join("; ");
      const token = await page.evaluate(() => {
        return localStorage.getItem("accessToken") || localStorage.getItem("token") || "";
      });

      const headers = {
        "Content-Type": "application/json;charset=UTF-8",
        accessToken: token,
        Cookie: cookieStr,
        Origin: "https://toptou.tec-do.com",
        Referer: "https://toptou.tec-do.com/",
      };

      try {
        const r = await axios.post(BASE_API + "/facebook/editor/name-or-budget", {
          level: 1,
          id: internalId,
          accountId: TEST_ACCOUNT,
          budgetMode: "DAY",
          budget: String(campData.daily_budget || campData.budget || "50"),
          currency: campData.currency || "USD",
        }, { headers, timeout: 10000 });
        console.log("RESULT:", r.data.code, r.data.msg);
        if (r.data.code === 200) console.log("SUCCESS!!!");
      } catch (e) {
        console.log("ERR:", e.response?.data || e.message);
      }
    }
  }

  await browser.close();
  console.log("\n=== Done ===");
}
main();
