'use strict';

/**
 * services/chat_capture_service.js
 */

let routeConversation = null;
try {
  ({ routeConversation } = require('./chatgpt_conversation_router'));
} catch (_err) {
  routeConversation = null;
}

let recordCandidateService = {};
try {
  recordCandidateService = require('./record_candidate_service');
} catch (_err) {
  recordCandidateService = {};
}

let recordNormalizerService = {};
try {
  recordNormalizerService = require('./record_normalizer_service');
} catch (_err) {
  recordNormalizerService = {};
}

let painSupportService = {};
try {
  painSupportService = require('./pain_support_service');
} catch (_err) {
  painSupportService = {};
}

function safeText(value, fallback = '') {
  if (typeof recordNormalizerService.safeText === 'function') {
    try {
      return recordNormalizerService.safeText(value, fallback);
    } catch (_err) {}
  }
  return String(value || fallback).trim();
}

function normalizeRecordCandidate(raw = {}) {
  if (typeof recordNormalizerService.normalizeRecordCandidate === 'function') {
    try {
      return recordNormalizerService.normalizeRecordCandidate(raw);
    } catch (_err) {}
  }
  return {
    type: safeText(raw.type || raw.record_type || raw.kind || 'unknown'),
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5,
    needs_confirmation: raw.needs_confirmation !== false,
    source: safeText(raw.source || 'text'),
    parsed_payload: raw.parsed_payload || raw.payload || {},
    user_facing_summary: safeText(raw.user_facing_summary || ''),
    save_action: safeText(raw.save_action || ''),
    meta: raw.meta || {},
  };
}

function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function includesAny(text = '', patterns = []) {
  return patterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern instanceof RegExp) return pattern.test(text);
    return text.includes(String(pattern));
  });
}

function extractAllNumbers(text = '') {
  return (
    String(text || '')
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map((v) => Number(v))
      .filter((v) => Number.isFinite(v)) || []
  );
}

function isProfileEditText(text = '') {
  const normalized = normalizeText(text);
  return includesAny(normalized, ['プロフィール変更', 'プロフィール修正', 'プロフィール更新', '身長', '年齢', '目標体重', '活動量']);
}

function looksLikeConsultation(text = '') {
  const raw = String(text || '').trim();
  const normalized = normalizeText(raw);
  if (!normalized) return false;
  if (isProfileEditText(raw)) return false;
  if (/[?？]/.test(raw)) return true;

  const patterns = [
    'どうしたら', 'どうすれば', 'いいですか', 'でしょうか', 'かな', '相談', '不安',
    '痛い', '頭痛', '腰痛', '膝痛', '違和感', '大丈夫', '平気', 'つらい', 'しんどい',
    '走っていい', '歩いていい', 'お腹すいた', '何食べ', 'なに食べ', 'ラーメン', '覚えてる'
  ];
  return includesAny(normalized, patterns);
}

function tryBodyMetrics(text = '') {
  const raw = safeText(text);
  const normalized = normalizeText(raw);
  if (!raw) return null;
  if (looksLikeConsultation(raw)) return null;
  if (isProfileEditText(raw)) return null;
  if (!includesAny(normalized, ['体重', '体脂肪', 'kg', 'キロ', '%', '％'])) return null;

  const numbers = extractAllNumbers(raw);
  if (!numbers.length) return null;

  const weightMatch = raw.match(/(\d+(?:\.\d+)?)\s*(kg|ｋｇ|キロ)/i);
  const bodyFatMatch = raw.match(/(\d+(?:\.\d+)?)\s*(%|％)/);

  const weightKg = weightMatch ? Number(weightMatch[1]) : (numbers[0] >= 20 && numbers[0] <= 300 ? numbers[0] : null);
  const bodyFatPct = bodyFatMatch ? Number(bodyFatMatch[1]) : (numbers[1] >= 1 && numbers[1] <= 80 ? numbers[1] : null);

  if (weightKg == null && bodyFatPct == null) return null;

  return {
    route: 'body_metrics',
    type: 'body_metrics',
    payload: {
      weight_kg: Number.isFinite(weightKg) ? Math.round(weightKg * 10) / 10 : null,
      body_fat_pct: Number.isFinite(bodyFatPct) ? Math.round(bodyFatPct * 10) / 10 : null,
      source_text: raw,
    },
  };
}

function buildPainRoute(text = '') {
  const raw = safeText(text);
  if (!raw) return null;

  const looksLikePain = typeof painSupportService.looksLikePainConsultation === 'function'
    ? painSupportService.looksLikePainConsultation(raw)
    : includesAny(normalizeText(raw), ['痛い', '痛み', 'しびれ', '違和感', '腫れ', '張る', '頭痛', '腰痛', '膝痛']);

  if (!looksLikePain) return null;

  let guidance = '';
  if (typeof painSupportService.generatePainResponse === 'function') {
    try {
      const result = painSupportService.generatePainResponse({ text: raw });
      guidance = typeof result === 'string'
        ? result
        : safeText(result?.text || result?.reply || result?.message || '');
    } catch (_err) {
      guidance = '';
    }
  }

  return {
    route: 'pain_consult',
    replyText: guidance,
    source_text: raw,
  };
}

async function buildConversationRoute(text = '', context = {}) {
  if (typeof routeConversation !== 'function') {
    return { route: 'conversation', replyText: '', source_text: safeText(text), meta: context };
  }
  try {
    const result = await routeConversation({ currentUserText: text, text, context, recentMessages: [] });
    return {
      route: result?.route || 'conversation',
      replyText: safeText(result?.replyText || result?.reply_text || result?.text || ''),
      source_text: safeText(text),
      meta: result?.meta || {},
      top_record_candidate: result?.top_record_candidate || null,
    };
  } catch (_err) {
    return { route: 'conversation', replyText: '', source_text: safeText(text), meta: context };
  }
}

async function analyzeChatCapture(input = {}) {
  const text = safeText(input.text || input.userText || '');
  const context = input.context || {};
  if (!text) return null;

  if (looksLikeConsultation(text)) {
    const painRoute = buildPainRoute(text);
    if (painRoute && painRoute.replyText) return painRoute;
    const conversation = await buildConversationRoute(text, context);
    if (conversation?.replyText || conversation?.route === 'consultation') return conversation;
    return {
      route: 'consultation',
      replyText: '気になっていること、そのまま話してくださいね。状況を見ながら一緒に整理します。',
      source_text: text,
    };
  }

  const metrics = tryBodyMetrics(text);
  if (metrics) return metrics;

  if (typeof recordCandidateService.getTopRecordCandidate === 'function') {
    try {
      const candidate = recordCandidateService.getTopRecordCandidate(text);
      if (candidate) {
        return {
          route: 'record_candidate',
          candidate: normalizeRecordCandidate(candidate),
          source_text: text,
        };
      }
    } catch (_err) {}
  }

  return buildConversationRoute(text, context);
}

module.exports = {
  analyzeChatCapture,
};
