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
    return "数値は受け取れています。今日の記録として残して大丈夫ですか？";
  }

  return `${parts.join("、")}で受け取れています。このまま今日の記録として残して大丈夫ですか？`;
}

function parseBodyMetrics(raw = "") {
  const text = String(raw || "").trim();
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const payload = {};
  const rounded = (value) => Math.round(Number(value) * 10) / 10;
  const takeWeight = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 20 && n <= 300) payload.weight_kg = rounded(n);
  };
  const takeBodyFat = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1 && n <= 80) payload.body_fat_percent = rounded(n);
  };

  const weightMatch = text.match(/(?:体重|wt|weight)\s*[:：]?(?:は)?\s*(-?\d{2,3}(?:\.\d+)?)\s*(?:kg|キロ)?/i);
  if (weightMatch) takeWeight(weightMatch[1]);

  const bodyFatMatch = text.match(/(?:体脂肪(?:率)?|fat|bf)\s*[:：]?(?:は)?\s*(-?\d{1,2}(?:\.\d+)?)\s*(?:%|％|パーセント|ぱーせんと|パー|ぱー)?/i);
  if (bodyFatMatch) takeBodyFat(bodyFatMatch[1]);

  const compactCombined = text.match(/体重\s*(-?\d{2,3}(?:\.\d+)?)\s*(?:kg|キロ)?[^\d]+体脂肪(?:率)?\s*(-?\d{1,2}(?:\.\d+)?)\s*(?:%|％|パーセント|ぱーせんと|パー|ぱー)?/i);
  if (compactCombined) {
    takeWeight(compactCombined[1]);
    takeBodyFat(compactCombined[2]);
  }

  const numbers = extractAllNumbers(text);
  if ((!payload.weight_kg || !payload.body_fat_percent) && numbers.length >= 2 && normalized.includes("体脂肪")) {
    if (!payload.weight_kg) takeWeight(numbers[0]);
    if (!payload.body_fat_percent) takeBodyFat(numbers[1]);
  }

  if (!payload.weight_kg && !payload.body_fat_percent && numbers.length === 1) {
    const value = numbers[0];
    if (/%|％/.test(text) || /(体脂肪|パーセント|ぱーせんと|パー|ぱー)/.test(text)) {
      takeBodyFat(value);
    } else if (/(kg|キロ)/i.test(text) || normalized.includes("体重") || (value >= 20 && value <= 300)) {
      takeWeight(value);
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
