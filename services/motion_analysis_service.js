"use strict";

/**
 * services/motion_analysis_service.js
 *
 * 目的:
 * - 「ここから。」の動作解析を Gemini で実行する。
 * - 単なる欠点指摘ではなく、強み起点・適応理解・生活翻訳・温かさを持つ返答を返す。
 * - 複数画像または動画キーフレームを受け取り、整形済み JSON を返す。
 *
 * 想定依存関係:
 *   npm install @google/genai sharp
 *
 * 重要な最上位思想:
 * 「私はプロのトレーナーとして、このAIを『正しさの押し付け』ではなく
 *  『可能性の発見』のためのツールにしたい。コードの各所に、ユーザーを
 *  元気づけるための『余白』と『温かさ』を込めてくれ。」
 */

const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const {
  prepareInlineImages,
  compactInlineFrames,
  normalizeEnergyLevel,
} = require("./image_processor");

const PRIMARY_MODEL = process.env.GEMINI_MOTION_PRIMARY_MODEL || "gemini-2.5-flash-lite";
const FALLBACK_MODEL = process.env.GEMINI_MOTION_FALLBACK_MODEL || "gemini-1.5-flash";
const DEFAULT_MAX_OUTPUT_TOKENS = 1400;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 900;

const MOTION_ANALYSIS_SYSTEM_PROMPT = String.raw`【最上位思想】
私はプロのトレーナーとして、このAIを「正しさの押し付け」のためではなく、「可能性の発見」のためのツールにしたい。
そのため、あなたの返答には、ユーザーをただ評価するための冷たい正解ではなく、前向きな変化のきっかけになる「余白」と「温かさ」を込めること。

【役割】
あなたは、柔道整復師的な安全感覚と、日本代表レベルのトレーナーの観察眼を併せ持つ動作解析アシスタントである。
ただし医療診断を断定してはならない。

【実装原則】
1. 正しさよりも、可能性を見つける。
2. 修正よりも先に、理解と安心を返す。
3. 指摘よりも先に、強みを見つける。
4. 詰め込むよりも、受け取れる余白を残す。
5. 完成形を押し付けず、その人らしい前進を支える。

【解析方針】
- 欠点の指摘より前に、必ず良い所・活かせる特徴を見つける。
- 動かない部位を責めず、それを補う代償動作を「今のベストな適応」として理解する。
- スポーツ動作を、歩行・階段・炊事・抱っこ・洗濯などの日常動作へ翻訳する。
- 心の状態は断定せず、動きの硬さや守りの動きとして観察し、問いかけベースで扱う。
- 主観的な褒めは、必ず具体的な観察事実とセットにする。
- 一度に提案する修正は 1〜2 個までにする。
- 疲労・痛み・低 energy の時は、改善より休息と安心を優先する。

【返答ルール】
- まず見えている事実を書く。
- 次に強みを書く。
- 気になる点は最大 2 個まで。
- 修正案は最大 2 個まで。
- 心の状態は断定せず、「〜かもしれません」「〜でしょうか」と問いかけベースにする。
- 低 energy の時は、労いと最優先 1 点のみを返す。

【出力形式】
JSON のみを返す。Markdown のコードブロックは使わない。`;

const MOTION_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    observed_facts: {
      type: "array",
      items: { type: "string" },
    },
    strengths: {
      type: "array",
      items: { type: "string" },
    },
    concerns: {
      type: "array",
      items: { type: "string" },
    },
    possible_backgrounds: {
      type: "array",
      items: { type: "string" },
    },
    minimal_corrections: {
      type: "array",
      items: { type: "string" },
    },
    daily_life_translation: {
      type: "array",
      items: { type: "string" },
    },
    recovery_first_message: { type: "string" },
    medical_attention_note: { type: "string" },
    confidence: {
      type: "object",
      properties: {
        visual_confidence: { type: "string" },
        affect_inference_guard: { type: "string" },
      },
      required: ["visual_confidence", "affect_inference_guard"],
    },
    metadata: {
      type: "object",
      properties: {
        sport: { type: "string" },
        motion_type: { type: "string" },
        energy_level: { type: "string" },
        frames_used: { type: "integer" },
        model_used: { type: "string" },
        fallback_used: { type: "boolean" },
      },
      required: ["frames_used", "model_used", "fallback_used"],
    },
  },
  required: [
    "summary",
    "observed_facts",
    "strengths",
    "concerns",
    "possible_backgrounds",
    "minimal_corrections",
    "daily_life_translation",
    "recovery_first_message",
    "medical_attention_note",
    "confidence",
    "metadata",
  ],
};

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for motion analysis.");
  }
  return new GoogleGenAI({ apiKey });
}

function createDefaultResult(overrides = {}) {
  return {
    summary: "今回は安全優先で簡易結果を返します。強みを一つ見つけつつ、負担を増やさない見方を続けましょう。",
    observed_facts: [],
    strengths: ["今の条件の中で支えようとしている動きが見られます。"],
    concerns: [],
    possible_backgrounds: [],
    minimal_corrections: ["まずは一つだけ、呼吸を止めずに楽に動ける範囲を確認してください。"],
    daily_life_translation: [],
    recovery_first_message: "今日は整えるより、安心して動ける範囲を確認する日でも大丈夫です。",
    medical_attention_note: "強い痛み、しびれ、脱力、腫れ、熱感、急な悪化がある場合は医療相談を優先してください。",
    confidence: {
      visual_confidence: "limited",
      affect_inference_guard: "動画や画像だけでは心の状態を断定していません。",
    },
    metadata: {
      sport: overrides.sport || "",
      motion_type: overrides.motion_type || "",
      energy_level: overrides.energy_level || "unknown",
      frames_used: Number(overrides.frames_used || 0),
      model_used: overrides.model_used || "",
      fallback_used: Boolean(overrides.fallback_used),
    },
  };
}

function stripMarkdownCodeFence(text) {
  if (!text) return "";
  const trimmed = String(text).trim();
  return trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function safeJsonParse(rawText, fallbackMetadata = {}) {
  try {
    const sanitized = stripMarkdownCodeFence(rawText);
    const firstBrace = sanitized.indexOf("{");
    const lastBrace = sanitized.lastIndexOf("}");
    const candidate = firstBrace >= 0 && lastBrace > firstBrace
      ? sanitized.slice(firstBrace, lastBrace + 1)
      : sanitized;
    const parsed = JSON.parse(candidate);
    return normalizeResult(parsed, fallbackMetadata);
  } catch (error) {
    return createDefaultResult({
      ...fallbackMetadata,
      model_used: fallbackMetadata.model_used || "parse-fallback",
    });
  }
}

function truncateArray(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.filter(Boolean).slice(0, maxLength).map((item) => String(item).trim()).filter(Boolean);
}

function normalizeResult(result, metadata = {}) {
  const normalized = createDefaultResult(metadata);
  normalized.summary = String(result?.summary || normalized.summary).trim();
  normalized.observed_facts = truncateArray(result?.observed_facts, 6);
  normalized.strengths = truncateArray(result?.strengths, 2);
  normalized.concerns = truncateArray(result?.concerns, 2);
  normalized.possible_backgrounds = truncateArray(result?.possible_backgrounds, 3);
  normalized.minimal_corrections = truncateArray(result?.minimal_corrections, 2);
  normalized.daily_life_translation = truncateArray(result?.daily_life_translation, 2);
  normalized.recovery_first_message = String(
    result?.recovery_first_message || normalized.recovery_first_message,
  ).trim();
  normalized.medical_attention_note = String(
    result?.medical_attention_note || normalized.medical_attention_note,
  ).trim();
  normalized.confidence = {
    visual_confidence: String(result?.confidence?.visual_confidence || normalized.confidence.visual_confidence),
    affect_inference_guard: String(
      result?.confidence?.affect_inference_guard || normalized.confidence.affect_inference_guard,
    ),
  };
  normalized.metadata = {
    ...normalized.metadata,
    ...metadata,
    sport: String(result?.metadata?.sport || metadata.sport || ""),
    motion_type: String(result?.metadata?.motion_type || metadata.motion_type || ""),
    energy_level: String(result?.metadata?.energy_level || metadata.energy_level || "unknown"),
    frames_used: Number(result?.metadata?.frames_used || metadata.frames_used || 0),
    model_used: String(result?.metadata?.model_used || metadata.model_used || ""),
    fallback_used: Boolean(
      result?.metadata?.fallback_used !== undefined
        ? result.metadata.fallback_used
        : metadata.fallback_used,
    ),
  };

  if (normalized.strengths.length === 0) {
    normalized.strengths = ["今ある条件の中で支えようとしている点が、この動きの土台になっています。"];
  }

  return normalized;
}

function toRetryableDelay(attempt, baseMs = DEFAULT_RETRY_BASE_MS) {
  const jitter = Math.floor(Math.random() * 200);
  return baseMs * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStatus(error, code) {
  const message = String(error?.message || "");
  const status = error?.status || error?.code || error?.statusCode;
  return Number(status) === code || message.includes(String(code));
}

function buildUserPrompt(context = {}) {
  const {
    sport = "",
    motionType = "",
    symptoms = "",
    goal = "",
    note = "",
    timeOfDay = "",
    energyLevel = "unknown",
    userProfile = "",
  } = context;

  return [
    "以下は動作解析依頼です。画像群をまとめて見て、一貫したフォームの特徴を評価してください。",
    `スポーツ: ${sport || "未指定"}`,
    `動作種別: ${motionType || "未指定"}`,
    `気になる症状・困りごと: ${symptoms || "未指定"}`,
    `目標: ${goal || "未指定"}`,
    `補足メモ: ${note || "なし"}`,
    `時間帯補正: ${timeOfDay || "未指定"}`,
    `energy_level: ${normalizeEnergyLevel(energyLevel)}`,
    `対象者プロフィール: ${userProfile || "未指定"}`,
    "JSON のみで返してください。Markdown のコードブロックは禁止です。",
    "主観的な褒めは、必ず観察事実とセットにしてください。",
    "心の状態は断定せず、仮説または問いかけとして扱ってください。",
  ].join("\n");
}

async function generateOnce({ client, model, frames, context, fallbackUsed = false }) {
  const contents = [
    buildUserPrompt(context),
    ...frames.map((frame) => ({
      inlineData: {
        mimeType: frame.mimeType,
        data: frame.data,
      },
    })),
  ];

  const response = await client.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: MOTION_ANALYSIS_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema: MOTION_ANALYSIS_RESPONSE_SCHEMA,
      temperature: 0.35,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    },
  });

  const text = typeof response?.text === "string"
    ? response.text
    : response?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";

  return safeJsonParse(text, {
    sport: context.sport || "",
    motion_type: context.motionType || "",
    energy_level: normalizeEnergyLevel(context.energyLevel),
    frames_used: frames.length,
    model_used: model,
    fallback_used: fallbackUsed,
  });
}

async function runWithRetry({ client, model, frames, context, fallbackUsed = false }) {
  let currentFrames = frames;

  for (let attempt = 1; attempt <= DEFAULT_MAX_RETRIES; attempt += 1) {
    try {
      return await generateOnce({
        client,
        model,
        frames: currentFrames,
        context,
        fallbackUsed,
      });
    } catch (error) {
      if (isStatus(error, 413)) {
        currentFrames = await compactInlineFrames(currentFrames, {
          maxDimension: 960,
          maxBytesPerImage: 260 * 1024,
          quality: 72,
        });
        continue;
      }

      if (isStatus(error, 503) && attempt < DEFAULT_MAX_RETRIES) {
        await sleep(toRetryableDelay(attempt));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Motion analysis failed after ${DEFAULT_MAX_RETRIES} attempts.`);
}

/**
 * analyzeMotionFrames
 *
 * @param {Object} params
 * @param {Array<{buffer?: Buffer, data?: string, mimeType?: string, path?: string}>} params.frames
 * @param {Object} params.context
 * @returns {Promise<Object>} normalized result JSON
 */
async function analyzeMotionFrames({ frames, context = {} }) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return createDefaultResult({
      sport: context.sport || "",
      motion_type: context.motionType || "",
      energy_level: normalizeEnergyLevel(context.energyLevel),
      frames_used: 0,
      model_used: "no-input",
      fallback_used: false,
    });
  }

  const client = getClient();
  const preparedFrames = await prepareInlineImages(frames, {
    maxDimension: 1280,
    maxBytesPerImage: 420 * 1024,
    quality: 80,
  });

  try {
    return await runWithRetry({
      client,
      model: PRIMARY_MODEL,
      frames: preparedFrames,
      context,
      fallbackUsed: false,
    });
  } catch (primaryError) {
    const fallbackResult = await runWithRetry({
      client,
      model: FALLBACK_MODEL,
      frames: preparedFrames,
      context,
      fallbackUsed: true,
    });

    if (process.env.MOTION_ANALYSIS_DEBUG === "1") {
      fallbackResult.metadata.primary_error = String(primaryError?.message || primaryError);
    }

    return fallbackResult;
  }
}

/**
 * analyzeMotionFiles
 *
 * still image paths or extracted frame paths をそのまま渡せる簡易入口。
 */
async function analyzeMotionFiles({ imagePaths, context = {} }) {
  const frames = (imagePaths || []).map((filePath) => ({ path: filePath }));
  return analyzeMotionFrames({ frames, context });
}

module.exports = {
  analyzeMotionFrames,
  analyzeMotionFiles,
  createDefaultResult,
  stripMarkdownCodeFence,
  safeJsonParse,
  MOTION_ANALYSIS_SYSTEM_PROMPT,
  MOTION_ANALYSIS_RESPONSE_SCHEMA,
};
