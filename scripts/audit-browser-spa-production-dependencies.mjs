import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = process.cwd();
const SOURCE_ROOT = path.join(APP_ROOT, "src");
const LOCKFILE_PATH = path.join(APP_ROOT, "package-lock.json");

export const RSC_EXCEPTION = Object.freeze({
  advisoryId: "GHSA-QWWW-VCR4-C8H2",
  packageName: "react-router",
  lockedVersion: "7.18.0",
  expiresAt: "2026-08-31T23:59:59.999Z",
  url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2",
});

const severityRank = Object.freeze({
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
});

const advisoryIdFrom = (entry) => {
  const value = String(entry?.url || "");
  return value.match(/GHSA-[a-z0-9-]+/i)?.[0]?.toUpperCase();
};

export const classifyVulnerabilities = (report) => {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    return {
      allowed: [],
      blocked: [{ name: "npm-audit", reason: "审计结果缺少 vulnerabilities" }],
    };
  }

  const decisions = new Map();
  const isAllowed = (name, visiting = new Set()) => {
    if (decisions.has(name)) return decisions.get(name);
    if (visiting.has(name)) return false;
    const vulnerability = vulnerabilities[name];
    if (!vulnerability || !Array.isArray(vulnerability.via)) return false;

    const nextVisiting = new Set(visiting);
    nextVisiting.add(name);
    const allowed =
      vulnerability.via.length > 0 &&
      vulnerability.via.every((entry) => {
        if (typeof entry === "string") {
          return isAllowed(entry, nextVisiting);
        }
        return (
          advisoryIdFrom(entry) === RSC_EXCEPTION.advisoryId &&
          (entry.name === RSC_EXCEPTION.packageName ||
            entry.dependency === RSC_EXCEPTION.packageName)
        );
      });
    decisions.set(name, allowed);
    return allowed;
  };

  const allowed = [];
  const blocked = [];
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    const severity = String(vulnerability?.severity || "").toLowerCase();
    if (
      (severityRank[severity] ?? severityRank.critical) < severityRank.moderate
    ) {
      continue;
    }
    if (isAllowed(name)) {
      allowed.push({ name, severity });
      continue;
    }
    blocked.push({
      name,
      severity,
      advisories: (vulnerability?.via || [])
        .filter((entry) => typeof entry === "object")
        .map((entry) => advisoryIdFrom(entry) || entry?.title)
        .filter(Boolean),
    });
  }
  return { allowed, blocked };
};

const collectSourceFiles = (directory, root = directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath, root));
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    files.push({
      path: path.relative(root, absolutePath),
      source: readFileSync(absolutePath, "utf8"),
    });
  }
  return files;
};

const RSC_USAGE_PATTERN =
  /\b(?:unstable_RSC\w*|RSCRouter|ServerRouter|StaticRouter|createRequestHandler|createStaticHandler|getRSCStream|decodeAction|decodeReply)\b|from\s+['"]react-router['"]|react-router\/(?:rsc|dom\/server)/;

export const validateExceptionEnvironment = ({
  lockVersion,
  sourceFiles,
  now = new Date(),
}) => {
  const errors = [];
  if (lockVersion !== RSC_EXCEPTION.lockedVersion) {
    errors.push(
      `例外仅允许 react-router ${RSC_EXCEPTION.lockedVersion}，当前为 ${lockVersion || "未知"}`,
    );
  }
  if (now.getTime() > Date.parse(RSC_EXCEPTION.expiresAt)) {
    errors.push(`安全例外已于 ${RSC_EXCEPTION.expiresAt} 到期`);
  }
  for (const file of sourceFiles) {
    if (RSC_USAGE_PATTERN.test(file.source)) {
      errors.push(`${file.path} 引入了 RSC/服务端 Router API`);
    }
  }
  return errors;
};

const summarizeBlocked = (blocked) =>
  blocked
    .map(
      (entry) =>
        `${entry.name} (${entry.severity || "unknown"})${
          entry.advisories?.length ? `: ${entry.advisories.join(", ")}` : ""
        }`,
    )
    .join("\n");

export const runProductionAudit = () => {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath
    ? process.execPath
    : process.platform === "win32"
      ? "npm.cmd"
      : "npm";
  const args = npmExecPath
    ? [npmExecPath, "audit", "--omit=dev", "--audit-level=moderate", "--json"]
    : ["audit", "--omit=dev", "--audit-level=moderate", "--json"];
  const result = spawnSync(command, args, {
    cwd: APP_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`无法执行 npm audit: ${result.error.message}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `npm audit 未返回有效 JSON${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  }

  if (result.status === 0) {
    console.log("Browser SPA production dependency audit passed.");
    return;
  }

  const { allowed, blocked } = classifyVulnerabilities(report);
  if (blocked.length > 0 || allowed.length === 0) {
    throw new Error(
      `Browser SPA production dependency audit blocked:\n${summarizeBlocked(
        blocked.length ? blocked : [{ name: "unknown-audit-failure" }],
      )}`,
    );
  }

  const lockfile = JSON.parse(readFileSync(LOCKFILE_PATH, "utf8"));
  const lockVersion =
    lockfile?.packages?.[`node_modules/${RSC_EXCEPTION.packageName}`]?.version;
  const environmentErrors = validateExceptionEnvironment({
    lockVersion,
    sourceFiles: collectSourceFiles(SOURCE_ROOT),
  });
  if (environmentErrors.length > 0) {
    throw new Error(
      `React Router RSC security exception is not applicable:\n${environmentErrors.join(
        "\n",
      )}`,
    );
  }

  console.warn(
    [
      `Risk-accepted ${RSC_EXCEPTION.advisoryId} for browser-only SPA usage.`,
      "The upstream advisory states that only unstable RSC APIs are affected;",
      "this check fails if RSC/server Router APIs appear, the lock changes, or the exception expires.",
      `Review by ${RSC_EXCEPTION.expiresAt}. ${RSC_EXCEPTION.url}`,
    ].join(" "),
  );
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    runProductionAudit();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
