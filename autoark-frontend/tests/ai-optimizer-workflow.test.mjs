import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../src/pages/AiOptimizerPage.tsx", import.meta.url),
  "utf8",
);
const apiSource = readFileSync(
  new URL("../src/services/optimizerLearning.ts", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const layoutSource = readFileSync(
  new URL("../src/components/Layout.tsx", import.meta.url),
  "utf8",
);

test("AI optimizer workflow is visible only to admins and has a navigation entry", () => {
  assert.match(appSource, /path="\/ai\/optimizers"/);
  assert.match(appSource, /requireRole="org_admin"/);
  assert.match(layoutSource, /to:\s*"\/ai\/optimizers"/);
  assert.match(layoutSource, /label:\s*"AI 投手"/);
  assert.match(layoutSource, /adminOnly:\s*true/);
});

test("the UI exposes learn, admin authorization, PAUSED draft, approval, publish, and evaluate stages", () => {
  assert.match(pageSource, /generatePlaybook/);
  assert.match(pageSource, /materializeReusableAssets/);
  assert.match(pageSource, /createExecutionMandate/);
  assert.match(pageSource, /createReplica/);
  assert.match(pageSource, /approveReplica/);
  assert.match(pageSource, /publishReplica/);
  assert.match(pageSource, /evaluateReplica/);
  assert.match(pageSource, /Campaign \/ AdSet \/ Ad 全部 PAUSED/);
  assert.match(pageSource, /尚未调用 Meta 写接口/);
  assert.match(pageSource, /组织 System User/);
  assert.match(pageSource, /\[System User\]/);
  assert.match(
    apiSource,
    /authorizationType\?: "system_user" \| "personal_user"/,
  );
  assert.doesNotMatch(pageSource, /启用广告[^。]*button/);
});

test("human buyer assets stay read-only and execution is mandate-driven", () => {
  assert.match(pageSource, /来源边界：只读上下文/);
  assert.match(pageSource, /Pixel 由产品账户映射自动解析，不能手选/);
  assert.match(apiSource, /mandateId: string/);
  assert.match(
    apiSource,
    /export const createReplica[\s\S]*?input:\s*\{[\s\S]*?mandateId: string;[\s\S]*?dailyBudget\?: number;[\s\S]*?\}/,
  );
  assert.doesNotMatch(pageSource, /account\.pixels\.map/);
  assert.doesNotMatch(
    pageSource,
    /createReplica\(playbook\._id,[\s\S]*?facebookTokenId/,
  );
});

test("the API uses an async generation poll and explicit PAUSED confirmations", () => {
  assert.match(apiSource, /playbook-generations/);
  assert.match(pageSource, /getPlaybookGeneration/);
  assert.match(pageSource, /\[["']queued["'],\s*["']running["']\]/);
  assert.match(apiSource, /APPROVE_PAUSED_REPLICA/);
  assert.match(apiSource, /PUBLISH_PAUSED_REPLICA/);
  assert.doesNotMatch(apiSource, /timeoutMs:\s*5 \* 60 \* 1000/);
});

test("learning is currency-scoped and target accounts must match the playbook currency", () => {
  assert.match(apiSource, /currency\?: string/);
  assert.match(pageSource, /学习币种/);
  assert.match(pageSource, /currency:\s*selectedCurrency \|\| undefined/);
  assert.match(
    pageSource,
    /const switchCurrency[\s\S]*?setPlaybook\(null\)[\s\S]*?setTokens\(\[\]\)/,
  );
  assert.match(
    pageSource,
    /account\.currency ===\s*playbook\.structure\.currency/,
  );
});
