const { chromium } = require("playwright");

const TOPTOU_URL = "https://toptou.tec-do.com";
const EMAIL = "zhuweiwei@adcreative.cn";
const PASSWORD = "whez1107.";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({
    viewport: { width: 1920, height: 1080 }, locale: "zh-CN",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  })).newPage();
  page.setDefaultTimeout(15000);

  // 拦截所有 API 请求和响应
  const apiLogs = [];
  page.on("request", req => {
    if (req.url().includes("phoenix") && req.method() === "POST") {
      const url = req.url().replace("https://toptou.tec-do.com/phoenix/v1.0", "");
      apiLogs.push({ type: "REQ", url, body: req.postData()?.substring(0, 200) });
    }
  });
  page.on("response", async resp => {
    if (resp.url().includes("phoenix") && resp.request().method() === "POST") {
      const url = resp.url().replace("https://toptou.tec-do.com/phoenix/v1.0", "");
      try {
        const body = await resp.json();
        if (body.code === 200 && body.data) {
          // 找包含 internal ID 的响应
          const dataStr = JSON.stringify(body.data).substring(0, 500);
          apiLogs.push({ type: "RESP", url, status: body.code, preview: dataStr });
        }
      } catch {}
    }
  });

  try {
    // 登录
    await page.goto(TOPTOU_URL + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('text=我已阅读并同意').first().click();
    await page.waitForTimeout(300);
    await page.fill('input[placeholder="邮箱"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button:has-text("登录")');
    await page.waitForTimeout(5000);
    if (page.url().includes("login")) { console.log("Login FAILED"); return; }
    console.log("Login OK");

    // 导航到 campaign 页面
    console.log("\n=== 导航到 campaign 管理页 ===");
    apiLogs.length = 0;  // 清空日志
    await page.goto(TOPTOU_URL + "/adMange/facebook?t=campaign&accountId=1617071489473004", {
      waitUntil: "domcontentloaded", timeout: 30000,
    });
    await page.waitForTimeout(8000);  // 等页面完全加载

    console.log("\n=== 页面加载期间的 API 调用 ===");
    for (const log of apiLogs) {
      console.log(`${log.type} ${log.url}`);
      if (log.body) console.log(`  Body: ${log.body}`);
      if (log.preview) console.log(`  Data: ${log.preview}`);
    }

    // 找表格中的第一个 campaign 行（跳过表头行）
    console.log("\n=== 分析表格结构 ===");
    const dataRows = await page.$$("table.el-table__body tbody tr, .el-table__body-wrapper tr");
    console.log("Data rows:", dataRows.length);

    // 获取前几行的内容
    for (let i = 0; i < Math.min(3, dataRows.length); i++) {
      const cells = await dataRows[i].$$("td");
      const texts = [];
      for (const cell of cells) {
        const t = (await cell.textContent())?.trim().substring(0, 30);
        if (t) texts.push(t);
      }
      console.log(`Row ${i}:`, texts.join(" | "));
    }

    // 找"编辑广告系列"按钮/图标
    console.log("\n=== 查找编辑入口 ===");
    const editTexts = await page.$$('text=编辑');
    console.log("Edit text elements:", editTexts.length);

    // 清空日志，准备记录编辑操作
    apiLogs.length = 0;

    // 试着找到并点击编辑图标（在 campaign name 旁边通常有个编辑 icon）
    // 先看第一个数据行有什么可以交互的元素
    if (dataRows.length > 0) {
      const firstRow = dataRows[0];
      // 鼠标悬停到第一行，可能会显示编辑按钮
      await firstRow.hover();
      await page.waitForTimeout(1000);

      // 找 hover 后出现的编辑相关元素
      const hoverBtns = await page.$$('.el-tooltip, [class*="edit"], [class*="icon"]');
      console.log("Hover buttons:", hoverBtns.length);

      // 看看 aria 属性或 title
      for (const btn of hoverBtns.slice(0, 10)) {
        const title = await btn.getAttribute("title").catch(() => "");
        const ariaLabel = await btn.getAttribute("aria-label").catch(() => "");
        const cls = await btn.getAttribute("class").catch(() => "");
        if (title || ariaLabel || cls?.includes("edit")) {
          console.log("  Btn:", { title, ariaLabel, class: cls?.substring(0, 40) });
        }
      }

      // 尝试双击 campaign name 或点击编辑图标触发编辑
      const nameCell = (await firstRow.$$("td"))[1]; // 通常第二列是名称
      if (nameCell) {
        const nameText = await nameCell.textContent();
        console.log("\nName cell text:", nameText?.substring(0, 50));
        // 找这个 cell 里的编辑图标
        const editIcon = await nameCell.$('[class*="edit"], svg, i');
        if (editIcon) {
          console.log("Found edit icon in name cell, clicking...");
          await editIcon.click();
          await page.waitForTimeout(2000);
          console.log("\nAPI calls after edit click:");
          for (const log of apiLogs) {
            console.log(`  ${log.type} ${log.url}`);
            if (log.body) console.log(`    Body: ${log.body}`);
            if (log.preview) console.log(`    Data: ${log.preview}`);
          }
        }
      }
    }

    await page.screenshot({ path: "/tmp/toptou-debug.png" });

  } catch (err) {
    console.error("Error:", err.message);
    await page.screenshot({ path: "/tmp/toptou-error.png" }).catch(() => {});
  } finally {
    await browser.close();
    console.log("\n=== Done ===");
  }
}
main();
