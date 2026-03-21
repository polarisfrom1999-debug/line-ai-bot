"use strict";

function normalizeText(text = "") {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, "")
    .replace(/[!！?？。、,.]/g, "");
}

function parseNumber(text = "") {
  const match = String(text || "").match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractAllNumbers(text = "") {
  return String(text || "")
    .match(/-?\d+(?:\.\d+)?/g)?.map((v) => Number(v)).filter((v) => Number.isFinite(v)) || [];
}

function looksLikeConsultation(text = "") {
  const raw = String(text || "").trim();
  const normalized = normalizeText(raw);
  if (!normalized) return false;

  if (/[?？]/.test(raw)) return true;

  const patterns = [
    "どうしたら", "どうすれば", "いいですか", "でしょうか", "かな", "相談", "不安", "心配",
    "痛い", "しびれ", "つらい", "困る", "困ってる", "眠れない", "だめかな",
  ];

  return patterns.some((p) => normalized.includes(normalizeText(p)));
}

function buildBodyMetricReply(payload = {}) {
  const parts = [];
  if (Number.isFinite(Number(payload.weight_kg))) {
    parts.push(`体重${Number(payload.weight_kg)}kg`);
  }
  if (Number.isFinite(Number(payload.body_fat_percent))) {
    parts.push(`体脂肪率${Number(payload.body_fat_percent)}%`);
  }

  if (!parts.length) {
    return "こちらで数値として受け取っています。今日の記録として残して大丈夫ですか？";
  }

  return `${parts.join("、")}で受け取っています。今日の記録として残して大丈夫ですか？`;
}

function parseBodyMetrics(raw = "") {
  const text = String(raw || "").trim();
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const payload = {};

  const weightMatch = text.match(/(?:体重|wt|weight)?\s*(-?\d{2,3}(?:\.\d+)?)\s*kg?/i);
  if (weightMatch) {
    const weight = Number(weightMatch[1]);
    if (Number.isFinite(weight) && weight >= 20 && weight <= 300) {
      payload.weight_kg = Math.round(weight * 10) / 10;
    }
  }

  const bodyFatMatch = text.match(/(?:体脂肪(?:率)?|fat|bf)?\s*(-?\d{1,2}(?:\.\d+)?)\s*%/i);
  if (bodyFatMatch) {
    const bodyFat = Number(bodyFatMatch[1]);
    if (Number.isFinite(bodyFat) && bodyFat >= 1 && bodyFat <= 80) {
      payload.body_fat_percent = Math.round(bodyFat * 10) / 10;
    }
  }

  if (!payload.weight_kg && !payload.body_fat_percent) {
    const numbers = extractAllNumbers(text);
    if (numbers.length === 1) {
      const value = numbers[0];
      if (/%/.test(text) || normalized.includes("体脂肪")) {
        if (value >= 1 && value <= 80) payload.body_fat_percent = Math.round(value * 10) / 10;
      } else if (/kg/i.test(text) || normalized.includes("体重") || (value >= 20 && value <= 300)) {
        if (value >= 20 && value <= 300) payload.weight_kg = Math.round(value * 10) / 10;
      }
    }

    if (numbers.length >= 2 && (normalized.includes("体重") || normalized.includes("体脂肪") || /kg|%/i.test(text))) {
      const [first, second] = numbers;
      if (first >= 20 && first <= 300) payload.weight_kg = Math.round(first * 10) / 10;
      if (second >= 1 && second <= 80) payload.body_fat_percent = Math.round(second * 10) / 10;
    }
  }

  if (!payload.weight_kg && !payload.body_fat_percent) return null;
  return payload;
}

async function analyzeChatCapture({ userText = "" } = {}) {
  const raw = String(userText || "").trim();
  if (!raw) return null;
  if (looksLikeConsultation(raw)) return null;

  const payload = parseBodyMetrics(raw);
  if (!payload) return null;

  return {
    capture_type: "body_metrics",
    action: "needs_confirmation",
    needs_confirmation: true,
    payload,
    reply_text: buildBodyMetricReply(payload),
  };
}

module.exports = {
  analyzeChatCapture,
};
