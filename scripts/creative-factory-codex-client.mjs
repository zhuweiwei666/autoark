#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.AUTOARK_URL || "http://localhost:3001").replace(
  /\/+$/,
  "",
);
const secret = process.env.CREATIVE_FACTORY_CODEX_SECRET || "";
const workerId =
  process.env.CODEX_WORKER_ID || `codex-${process.env.USER || "operator"}`;

function usage() {
  process.stdout.write(`Creative Factory Codex client\n\n`);
  process.stdout.write(
    `  claim\n  catalog [featureKey]\n  plan <jobId> <plan.json>\n  refresh <jobId>\n  complete <jobId> <result.json>\n  fail <jobId> <message>\n  upload <jobId> <file>\n`,
  );
}

async function signedPost(route, body) {
  if (!secret) throw new Error("CREATIVE_FACTORY_CODEX_SECRET 未配置");
  const serialized = JSON.stringify(body);
  const signature = crypto
    .createHmac("sha256", secret)
    .update(serialized)
    .digest("hex");
  const response = await fetch(`${baseUrl}/api/creative-factory${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Codex-Signature": signature,
    },
    body: serialized,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    throw new Error(
      payload?.message ||
        payload?.error ||
        `AutoArk 请求失败 (${response.status})`,
    );
  }
  return payload.data;
}

const mimeFor = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".mp4": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
    }[ext] || "application/octet-stream"
  );
};

async function upload(jobId, filePath) {
  if (!jobId || !filePath) throw new Error("用法: upload <jobId> <file>");
  const file = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const mimeType = mimeFor(fileName);
  const target = await signedPost(
    `/codex/jobs/${encodeURIComponent(jobId)}/upload-url`,
    {
      workerId,
      fileName,
      mimeType,
      size: file.byteLength,
    },
  );
  const put = await fetch(target.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  if (!put.ok) throw new Error(`上传成品失败 (${put.status})`);
  return {
    role: "final",
    name: fileName,
    mediaType: mimeType.startsWith("video/") ? "video" : "image",
    mimeType,
    size: file.byteLength,
    storageProvider: "r2",
    storageKey: target.key,
    url: target.publicUrl,
  };
}

async function catalog(featureKey = "") {
  return signedPost("/codex/catalog", { workerId, featureKey });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") return usage();

  let result;
  if (command === "claim")
    result = await signedPost("/codex/claim", { workerId });
  else if (command === "catalog") result = await catalog(args[0]);
  else if (command === "plan") {
    const plan = JSON.parse(await fs.readFile(args[1], "utf8"));
    result = await signedPost(
      `/codex/jobs/${encodeURIComponent(args[0])}/plan`,
      { workerId, plan },
    );
  } else if (command === "refresh")
    result = await signedPost(
      `/codex/jobs/${encodeURIComponent(args[0])}/refresh`,
      { workerId },
    );
  else if (command === "complete") {
    const body = JSON.parse(await fs.readFile(args[1], "utf8"));
    result = await signedPost(
      `/codex/jobs/${encodeURIComponent(args[0])}/complete`,
      { ...body, workerId },
    );
  } else if (command === "fail")
    result = await signedPost(
      `/codex/jobs/${encodeURIComponent(args[0])}/fail`,
      { workerId, error: args.slice(1).join(" ") },
    );
  else if (command === "upload") result = await upload(args[0], args[1]);
  else throw new Error(`未知命令: ${command}`);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
