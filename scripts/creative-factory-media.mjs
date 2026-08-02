#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const backendRequire = createRequire(
  new URL("../autoark-backend/package.json", import.meta.url),
);
const sharp = backendRequire("sharp");

const escapeXml = (value) =>
  String(value || "").replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );
const escapeFfmpeg = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with ${code}`)),
    );
  });
}

const number = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const boxPosition = (box, width, height) => {
  const ratio = box.unit !== "px";
  return {
    x: Math.round(ratio ? number(box.x) * width : number(box.x)),
    y: Math.round(ratio ? number(box.y) * height : number(box.y)),
    width: Math.max(
      1,
      Math.round(ratio ? number(box.width) * width : number(box.width)),
    ),
    height: Math.max(
      1,
      Math.round(ratio ? number(box.height) * height : number(box.height)),
    ),
  };
};

async function editImage(recipe) {
  const image = sharp(recipe.input).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 1080;
  const height = metadata.height || 1920;
  const composites = [];

  for (const mask of recipe.masks || []) {
    const box = boxPosition(mask, width, height);
    const opacity = Math.min(Math.max(number(mask.opacity, 1), 0), 1);
    const fill = mask.color || recipe.brand?.background || "#111111";
    const svg = `<svg width="${box.width}" height="${box.height}"><rect width="100%" height="100%" rx="${number(mask.radius, 0)}" fill="${escapeXml(fill)}" fill-opacity="${opacity}"/></svg>`;
    composites.push({ input: Buffer.from(svg), left: box.x, top: box.y });
  }

  if (recipe.brand?.label) {
    const label = escapeXml(recipe.brand.label);
    const sublabel = escapeXml(recipe.brand.sublabel || "");
    const barHeight = Math.max(96, Math.round(height * 0.09));
    const svg = `<svg width="${width}" height="${barHeight}">
      <rect width="100%" height="100%" fill="${escapeXml(recipe.brand.background || "#111111")}" fill-opacity="0.92"/>
      <text x="${Math.round(width * 0.05)}" y="${Math.round(barHeight * 0.48)}" fill="${escapeXml(recipe.brand.color || "#ffffff")}" font-family="Arial,sans-serif" font-size="${Math.max(28, Math.round(width * 0.04))}" font-weight="700">${label}</text>
      <text x="${Math.round(width * 0.05)}" y="${Math.round(barHeight * 0.76)}" fill="#d4d4d8" font-family="Arial,sans-serif" font-size="${Math.max(18, Math.round(width * 0.022))}">${sublabel}</text>
    </svg>`;
    composites.push({
      input: Buffer.from(svg),
      left: 0,
      top: height - barHeight,
    });
  }

  if (recipe.brand?.logoPath) {
    const logoWidth = Math.max(
      80,
      Math.round(width * number(recipe.brand.logoWidthRatio, 0.18)),
    );
    const logo = await sharp(recipe.brand.logoPath)
      .resize({ width: logoWidth, withoutEnlargement: true })
      .png()
      .toBuffer();
    composites.push({
      input: logo,
      left: Math.round(width * 0.05),
      top: Math.round(height * 0.05),
    });
  }

  await image.composite(composites).toFile(recipe.output);
  return {
    mediaType: "image",
    width,
    height,
    output: path.resolve(recipe.output),
  };
}

async function probeVideo(input) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration",
      "-of",
      "json",
      input,
    ]);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffprobe exited with ${code}`)),
    );
  });
  const stream =
    JSON.parse(Buffer.concat(chunks).toString("utf8")).streams?.[0] || {};
  return {
    width: number(stream.width, 1080),
    height: number(stream.height, 1920),
    duration: number(stream.duration, 0),
  };
}

async function editVideo(recipe) {
  const meta = await probeVideo(recipe.input);
  const filters = [];
  for (const mask of recipe.masks || []) {
    const box = boxPosition(mask, meta.width, meta.height);
    const start = Number(mask.start);
    const end = Number(mask.end);
    const enable =
      Number.isFinite(start) && Number.isFinite(end)
        ? `:enable='between(t,${start},${end})'`
        : Number.isFinite(start)
          ? `:enable='gte(t,${start})'`
          : Number.isFinite(end)
            ? `:enable='lte(t,${end})'`
            : "";
    filters.push(
      `drawbox=x=${box.x}:y=${box.y}:w=${box.width}:h=${box.height}:color=${escapeFfmpeg(mask.color || recipe.brand?.background || "#111111")}@${number(mask.opacity, 1)}:t=fill${enable}`,
    );
  }
  if (recipe.crop) {
    const crop = boxPosition(recipe.crop, meta.width, meta.height);
    filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  }

  const args = ["-y"];
  if (recipe.trim?.start) args.push("-ss", String(number(recipe.trim.start)));
  args.push("-i", recipe.input);
  let brandOverlayPath = "";
  if (recipe.brand?.label || recipe.brand?.logoPath) {
    const overlayHeight = Math.max(80, Math.round(meta.height * 0.1));
    const fontSize = Math.max(28, Math.round(meta.width * 0.04));
    const logoWidth = recipe.brand?.logoPath
      ? Math.max(
          56,
          Math.round(meta.width * number(recipe.brand.logoWidthRatio, 0.14)),
        )
      : 0;
    const textX =
      Math.round(meta.width * 0.05) +
      (logoWidth ? logoWidth + Math.round(meta.width * 0.025) : 0);
    const brandSvg = `<svg width="${meta.width}" height="${overlayHeight}">
      <rect width="100%" height="100%" fill="${escapeXml(recipe.brand.background || "#111111")}" fill-opacity="0.92"/>
      <text x="${textX}" y="${Math.round(overlayHeight * 0.62)}" fill="${escapeXml(recipe.brand.color || "#ffffff")}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700">${escapeXml(recipe.brand.label || "")}</text>
    </svg>`;
    brandOverlayPath = `${recipe.output}.brand-overlay.png`;
    const overlay = sharp(Buffer.from(brandSvg));
    if (recipe.brand?.logoPath) {
      const logo = await sharp(recipe.brand.logoPath)
        .resize({
          width: logoWidth,
          height: Math.round(overlayHeight * 0.72),
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
      await overlay
        .composite([
          {
            input: logo,
            left: Math.round(meta.width * 0.05),
            top: Math.round(overlayHeight * 0.14),
          },
        ])
        .png()
        .toFile(brandOverlayPath);
    } else {
      await overlay.png().toFile(brandOverlayPath);
    }
    args.push("-i", brandOverlayPath);
  }
  if (recipe.trim?.duration)
    args.push("-t", String(number(recipe.trim.duration)));
  if (brandOverlayPath) {
    const baseFilters = filters.length ? filters.join(",") : "null";
    args.push(
      "-filter_complex",
      `[0:v]${baseFilters}[base];[base][1:v]overlay=0:H-h[outv]`,
      "-map",
      "[outv]",
      "-map",
      "0:a?",
    );
  } else if (filters.length) {
    args.push("-vf", filters.join(","));
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(number(recipe.crf, 19)),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    recipe.output,
  );
  try {
    await run("ffmpeg", args);
  } finally {
    if (brandOverlayPath) await fs.unlink(brandOverlayPath).catch(() => {});
  }
  const outputMeta = await probeVideo(recipe.output);
  return {
    mediaType: "video",
    ...outputMeta,
    output: path.resolve(recipe.output),
  };
}

async function main() {
  const recipePath = process.argv[2];
  if (!recipePath || recipePath === "--help") {
    process.stdout.write(
      "Usage: node scripts/creative-factory-media.mjs <recipe.json>\n",
    );
    return;
  }
  const recipe = JSON.parse(await fs.readFile(recipePath, "utf8"));
  if (
    !recipe.input ||
    !recipe.output ||
    !["image", "video"].includes(recipe.mediaType)
  )
    throw new Error("recipe 必须包含 input、output、mediaType");
  await fs.mkdir(path.dirname(path.resolve(recipe.output)), {
    recursive: true,
  });
  const result =
    recipe.mediaType === "video"
      ? await editVideo(recipe)
      : await editImage(recipe);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
