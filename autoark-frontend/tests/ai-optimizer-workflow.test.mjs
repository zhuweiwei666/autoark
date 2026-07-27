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

test("the UI exposes learn, PAUSED draft, explicit approval, publish, and evaluate stages", () => {
  assert.match(pageSource, /generatePlaybook/);
  assert.match(pageSource, /createReplica/);
  assert.match(pageSource, /approveReplica/);
  assert.match(pageSource, /publishReplica/);
  assert.match(pageSource, /evaluateReplica/);
  assert.match(pageSource, /Campaign \/ AdSet \/ Ad 全部 PAUSED/);
  assert.match(pageSource, /尚未调用 Meta 写接口/);
  assert.doesNotMatch(pageSource, /启用广告[^。]*button/);
});

test("the API uses an async generation poll and explicit PAUSED confirmations", () => {
  assert.match(apiSource, /playbook-generations/);
  assert.match(pageSource, /getPlaybookGeneration/);
  assert.match(pageSource, /\[["']queued["'],\s*["']running["']\]/);
  assert.match(apiSource, /APPROVE_PAUSED_REPLICA/);
  assert.match(apiSource, /PUBLISH_PAUSED_REPLICA/);
  assert.doesNotMatch(apiSource, /timeoutMs:\s*5 \* 60 \* 1000/);
});
