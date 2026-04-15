"use strict";

/**
 * services/image_processor.js
 *
 * 目的:
 * - 動画から 3〜5 枚のキーフレームを抽出する。
 * - 413 対策として、送信前に画像をリサイズ・再圧縮する。
 * - motion_analysis_service.js に渡しやすい inlineData 形式へ正規化する。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
let sharp = null;
try {
  sharp = require("sharp");
} catch (_error) {
  sharp = null;
}

const DEFAULT_MAX_DIMENSION = 1280;
const DEFAULT_MAX_BYTES_PER_IMAGE = 420 * 1024;
const DEFAULT_QUALITY = 80;

function normalizeEnergyLevel(value) {
  const input = String(value || "unknown").trim().toLowerCase();
  if (["very_low", "low", "medium", "high", "very_high", "unknown"].includes(input)) {
    return input;
  }
  if (["1", "2"].includes(input)) return "very_low";
  if (["3", "4"].includes(input)) return "low";
  if (["5", "6"].includes(input)) return "medium";
  if (["7", "8"].includes(input)) return "high";
  if (["9", "10"].includes(input)) return "very_high";
  return "unknown";
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

async function getVideoDurationSeconds(videoPath) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);

  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Unable to determine video duration for: ${videoPath}`);
  }
  return duration;
}

function buildTimestamps(durationSeconds, frameCount) {
  if (frameCount <= 1) return [Math.max(0, durationSeconds * 0.5)];

  const safeStart = Math.min(0.25, durationSeconds * 0.1);
  const safeEnd = Math.max(durationSeconds - 0.25, durationSeconds * 0.9);
  const usableRange = Math.max(0.1, safeEnd - safeStart);

  return Array.from({ length: frameCount }, (_, index) => {
    const ratio = frameCount === 1 ? 0.5 : index / (frameCount - 1);
    return Number((safeStart + usableRange * ratio).toFixed(3));
  });
}

async function extractKeyframesFromVideo({
  videoPath,
  frameCount = 5,
  outputDir,
  maxDimension = DEFAULT_MAX_DIMENSION,
  maxBytesPerImage = DEFAULT_MAX_BYTES_PER_IMAGE,
  quality = DEFAULT_QUALITY,
}) {
  if (!videoPath) {
    throw new Error("videoPath is required.");
  }

  const duration = await getVideoDurationSeconds(videoPath);
  const timestamps = buildTimestamps(duration, Math.max(3, Math.min(frameCount, 5)));
  const workingDir = outputDir || fs.mkdtempSync(path.join(os.tmpdir(), "kokokara-motion-"));
  const frames = [];

  for (const [index, timestamp] of timestamps.entries()) {
    const outputPath = path.join(workingDir, `frame_${index + 1}.jpg`);
    await runCommand("ffmpeg", [
      "-y",
      "-ss",
      String(timestamp),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      outputPath,
    ]);

    const optimized = await normalizeImageFile(outputPath, {
      maxDimension,
      maxBytesPerImage,
      quality,
      outputPath,
    });

    frames.push({
      path: optimized.outputPath,
      timestamp,
      mimeType: optimized.mimeType,
      data: optimized.data,
      byteLength: optimized.byteLength,
    });
  }

  return frames;
}

async function normalizeImageFile(filePath, options = {}) {
  const buffer = fs.readFileSync(filePath);
  return normalizeImageBuffer(buffer, {
    ...options,
    sourcePath: filePath,
    outputPath: options.outputPath || filePath,
  });
}

async function normalizeImageBuffer(buffer, options = {}) {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    maxBytesPerImage = DEFAULT_MAX_BYTES_PER_IMAGE,
    quality = DEFAULT_QUALITY,
    outputPath,
  } = options;

  let currentDimension = maxDimension;
  let currentQuality = quality;
  let rendered = null;

  if (!sharp) {
    const passThrough = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    if (outputPath) fs.writeFileSync(outputPath, passThrough);
    return {
      buffer: passThrough,
      data: passThrough.toString("base64"),
      mimeType: "image/jpeg",
      byteLength: passThrough.byteLength,
      outputPath,
    };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    rendered = await sharp(buffer)
      .rotate()
      .resize({
        width: currentDimension,
        height: currentDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: currentQuality, mozjpeg: true })
      .toBuffer();

    if (rendered.byteLength <= maxBytesPerImage) {
      break;
    }

    currentQuality = Math.max(52, currentQuality - 6);
    currentDimension = Math.max(720, Math.round(currentDimension * 0.88));
  }

  if (!rendered) {
    throw new Error("Failed to render normalized image buffer.");
  }

  if (outputPath) {
    fs.writeFileSync(outputPath, rendered);
  }

  return {
    buffer: rendered,
    data: rendered.toString("base64"),
    mimeType: "image/jpeg",
    byteLength: rendered.byteLength,
    outputPath,
  };
}

async function prepareInlineImages(frames, options = {}) {
  const results = [];

  for (const frame of frames) {
    if (!frame) continue;

    if (frame.data && frame.mimeType) {
      const normalized = await normalizeImageBuffer(Buffer.from(frame.data, "base64"), options);
      results.push({
        mimeType: normalized.mimeType,
        data: normalized.data,
        byteLength: normalized.byteLength,
      });
      continue;
    }

    if (frame.buffer) {
      const normalized = await normalizeImageBuffer(frame.buffer, options);
      results.push({
        mimeType: normalized.mimeType,
        data: normalized.data,
        byteLength: normalized.byteLength,
      });
      continue;
    }

    if (frame.path) {
      const normalized = await normalizeImageFile(frame.path, options);
      results.push({
        mimeType: normalized.mimeType,
        data: normalized.data,
        byteLength: normalized.byteLength,
      });
    }
  }

  return results;
}

async function compactInlineFrames(frames, options = {}) {
  const maxDimension = options.maxDimension || 960;
  const maxBytesPerImage = options.maxBytesPerImage || 260 * 1024;
  const quality = options.quality || 72;

  return prepareInlineImages(
    frames.map((frame) => ({ data: frame.data, mimeType: frame.mimeType })),
    { maxDimension, maxBytesPerImage, quality },
  );
}

module.exports = {
  extractKeyframesFromVideo,
  normalizeImageBuffer,
  normalizeImageFile,
  prepareInlineImages,
  compactInlineFrames,
  normalizeEnergyLevel,
};
