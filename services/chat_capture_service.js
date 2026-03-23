'use strict';

/**
 * services/chat_capture_service.js
 *
 * body_metrics / pain相談を先回り優先する版
 * - 体重 + 体脂肪率の同時入力を router より先に拾う
 * - 痛み相談は短すぎる返答になりにくいように先回りする
 * - index.js 互換キーを広めに返す
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

function parseNumber(text = '') {
  const match = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function extractAllNumbers(text = '') {
  return (
    String(text || '')
      .match(/-?\d+(?:\.\d+)?/g)
      ?.map((v) => Number(v))
      .filter((v) => Number.isFinite(v)) || []
  );
}

function includesAny(text = '', patterns = []) {
  return patterns.some((pattern) => {
    if (!pattern) return false;
    if (pattern instanceof RegExp) return pattern.test(text);
    return text.includes(String(pattern));
  });
}

function looksLikeConsultation(text = '') {
  const raw = String(text || '').trim();
  const normalized = normalizeText(raw);
  if (!normalized) return false;

  if (/[?？]/.test(raw)) return true;

  const patterns = [
    'どうしたら',
    'どうすれば',
    'いいですか',
    'でしょうか',
    'かな',
    '相談',
    '不安',
    '心配',
    '痛い',
    'しびれ',
    'つらい',
    '困る',
    '困ってる',
    '眠れない',
    'だめかな',
    '大丈夫かな',
    'してもいい',
    'したらだめ',
    'どう思う',
    '悩',
    'わからない',
  ];

  return patterns.some((p) => normalized.includes(normalizeText(p)));
}

function looksLikePainConsultation(text = '') {
  if (typeof painSupportService.looksLikePainConsultation === 'function') {
    try {
      return Boolean(painSupportService.looksLikePainConsultation(text));
    } catch (_err) {}
  }

  const normalized = normalizeText(text);
  if (!normalized) return false;

  return includesAny(normalized, [
    '膝',
    '腰',
    '肩',
    '首',
    '足首',
    '股関節',
    '背中',
    'しびれ',
    '痛い',
    '痛み',
    '違和感',
    'だるい',
    'つらい',
    '張る',
    'こわばる',
    '炎症',
    '坐骨',
    '足底',
    '腱膜炎',
  ]);
}

function looksLikeMemoryNote(text = '') {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  return includesAny(normalized, [
    '覚えて',
    '記憶して',
    'メモして',
    'ちなみに',
    '実は',
    '私は',
    'ぼくは',
    '俺は',
    '好き',
    '苦手',
    '嫌い',
    'よく食べる',
    '食べがち',
    '外食が多い',
    'コンビニが多い',
    '夜に食べやすい',
    '朝は食べない',
    '朝食べない',
    '甘いものが好き',
  ]);
}

function looksLikeBodyMetrics(text = '') {
  const raw = String(text || '').trim();
  const normalized = normalizeText(raw);
  if (!normalized) return false;

  if (/(?:体重|wt|weight)\s*[:：]?(?:は)?\s*-?\d{2,3}(?:\.\d+)?\s*(?:kg|ｋｇ|キロ)?/i.test(raw)) return true;
  if (/(?:体脂肪(?:率)?|fat|bf)\s*[:：]?(?:は)?\s*-?\d{1,2}(?:\.\d+)?\s*(?:%|％|パーセント|ぱーせんと|パー|ぱー)?/i.test(raw)) return true;
  if (/体重\s*-?\d{2,3}(?:\.\d+)?\s*(?:kg|キロ)?[^\d]+体脂肪(?:率)?\s*-?\d{1,2}(?:\.\d+)?/i.test(raw)) return true;
  if (/^(体重)?\d{2,3}(?:\.\d+)?kg?$/i.test(normalized)) return true;
  if (normalized.includes('体脂肪')) return true;

  return false;
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
    return '数値は受け取れています。今日の記録として残して大丈夫ですか？';
  }

  return `${parts.join('、')}で受け取れています。このまま今日の記録として残して大丈夫ですか？`;
}

function parseBodyMetrics(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return null;

  const normalized = text
    .replace(/[　]/g, ' ')
    .replace(/％/g, '%')
    .replace(/ｋｇ/gi, 'kg');

  const payload = {};
  const rounded = (value) => Math.round(Number(value) * 10) / 10;

  const takeWeight = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 20 && n <= 300) {
      payload.weight_kg = rounded(n);
    }
  };

  const takeBodyFat = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1 && n <= 80) {
      payload.body_fat_percent = rounded(n);
    }
  };

  const weightPatterns = [
    /(?:^|[\s、,，/])(?:体重|今朝の体重|本日の体重|今日の体重|wt|weight)\s*[:：]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:kg|キロ))?/i,
    /(?:^|[\s、,，/])(-?\d+(?:\.\d+)?)\s*(?:kg|キロ)/i,
  ];

  const bodyFatPatterns = [
    /(?:^|[\s、,，/])(?:体脂肪率|体脂肪|fat|bf)\s*[:：]?\s*(-?\d+(?:\.\d+)?)(?:\s*(?:%|パーセント|パー))?/i,
    /(?:^|[\s、,，/])(-?\d+(?:\.\d+)?)\s*(?:%|パーセント|パー)/i,
  ];

  for (const re of weightPatterns) {
    const m = normalized.match(re);
    if (m && m[1] != null) {
      takeWeight(m[1]);
      if (payload.weight_kg != null) break;
    }
  }

  for (const re of bodyFatPatterns) {
    const m = normalized.match(re);
    if (m && m[1] != null) {
      takeBodyFat(m[1]);
      if (payload.body_fat_percent != null) break;
    }
  }

  const numberList = extractAllNumbers(normalized);
  if (!Number.isFinite(Number(payload.weight_kg)) && !Number.isFinite(Number(payload.body_fat_percent)) && numberList.length >= 2) {
    const first = Number(numberList[0]);
    const second = Number(numberList[1]);

    if (Number.isFinite(first) && first >= 20 && first <= 300) takeWeight(first);
    if (Number.isFinite(second) && second >= 1 && second <= 80 && /体脂肪|%|％|パー/.test(normalized)) takeBodyFat(second);
  }

  if (!Number.isFinite(Number(payload.weight_kg)) && !Number.isFinite(Number(payload.body_fat_percent))) {
    return null;
  }

  return payload;
}

function buildMemoryPayload(text = '') {
  const raw = safeText(text);
  const normalized = normalizeText(raw);

  let memoryType = 'general';
  if (includesAny(normalized, ['甘いもの', '甘い物', 'お菓子', 'スイーツ'])) memoryType = 'sweet_preference';
  else if (includesAny(normalized, ['外食', 'コンビニ'])) memoryType = 'food_pattern';
  else if (includesAny(normalized, ['苦手', '嫌い'])) memoryType = 'dislike';
  else if (includesAny(normalized, ['好き', '好物'])) memoryType = 'preference';
  else if (includesAny(normalized, ['朝食べない', '朝は食べない', '朝食'])) memoryType = 'breakfast_habit';

  return {
    memory_candidates: [
      {
        memory_type: memoryType,
        content: raw,
        detail_json: {},
      },
    ],
    payload: {
      note_text: raw,
      memory_type: memoryType,
    },
  };
}

function buildMemoryReply(text = '') {
  const raw = safeText(text);
  if (!raw) return '内容は受け取れています。メモとして残して大丈夫ですか？';
  return 'ありがとうございます。今後の伴走に活かせる内容として受け取っています。メモとして残して大丈夫ですか？';
}

function getTopRecordCandidate(text = '') {
  if (typeof recordCandidateService.getTopRecordCandidate === 'function') {
    try {
      return recordCandidateService.getTopRecordCandidate(text);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

function withCompatAliases(result = {}) {
  if (!result) return null;

  const replyText = safeText(result.reply_text || result.replyText || result.text || '');
  const recordCandidate = result.record_candidate || result.recordCandidate || null;

  return {
    ...result,
    type: safeText(result.capture_type || result.type || result.category || ''),
    reply_text: replyText,
    replyText,
    text: replyText,
    record_candidate: recordCandidate,
    recordCandidate,
    needs_confirmation: result.needs_confirmation !== false,
    needsConfirmation: result.needs_confirmation !== false,
    auto_save: Boolean(result.auto_save),
    autoSave: Boolean(result.auto_save),
  };
}

function buildRecordCaptureResult(candidate = null) {
  if (!candidate || !candidate.type) return null;

  const normalized = normalizeRecordCandidate(candidate);
  const type = safeText(normalized.type);

  if (type === 'meal') {
    return withCompatAliases({
      category: 'meal_record',
      capture_type: 'meal_record',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: normalized.parsed_payload || {},
      record_candidate: normalized,
      reply_text:
        safeText(normalized.meta?.reply_text) ||
        '食事の内容は受け取れています。今日の記録としてまとめてよければ保存しますか？違うところだけ、そのまま教えても大丈夫です。',
    });
  }

  if (type === 'exercise') {
    return withCompatAliases({
      category: 'exercise_record',
      capture_type: 'exercise_record',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: normalized.parsed_payload || {},
      record_candidate: normalized,
      reply_text:
        safeText(normalized.meta?.reply_text) ||
        '運動の内容は受け取れています。このまま今日の記録として残して大丈夫ですか？',
    });
  }

  if (type === 'weight' || type === 'body_fat') {
    return withCompatAliases({
      category: 'body_metrics',
      capture_type: 'body_metrics',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: normalized.parsed_payload || {},
      record_candidate: normalized,
      reply_text: buildBodyMetricReply(normalized.parsed_payload || {}),
    });
  }

  if (type === 'blood_test') {
    return withCompatAliases({
      category: 'blood_test',
      capture_type: 'blood_test',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: normalized.parsed_payload || {},
      record_candidate: normalized,
      reply_text: '血液検査の内容を受け取れています。このまま記録候補として進めて大丈夫ですか？',
    });
  }

  return null;
}

function buildPainConsultReply(userText = '') {
  const raw = safeText(userText);

  if (typeof painSupportService.buildPainReply === 'function') {
    try {
      const result = painSupportService.buildPainReply({ userText: raw });
      if (result && typeof result === 'object') {
        return safeText(result.reply_text || result.text || '');
      }
      if (safeText(result)) return safeText(result);
    } catch (_err) {}
  }

  if (typeof painSupportService.buildPainSupportResponse === 'function') {
    try {
      const result = painSupportService.buildPainSupportResponse(raw);
      if (result && typeof result === 'object') {
        const text = safeText(result.text || result.reply_text || '');
        if (text) return text;
      }
      if (safeText(result)) return safeText(result);
    } catch (_err) {}
  }

  return 'それは気になりますね。まずは記録より相談として受け取ります。無理を広げず、強い痛みや長引く症状がある時は牛込や医療機関にも相談してください。';
}

function buildPriorityCaptureResult(userText = '') {
  const raw = safeText(userText);
  const normalized = normalizeText(raw);
  if (!raw) return null;

  if (looksLikePainConsultation(raw) || looksLikeConsultation(raw)) {
    return withCompatAliases({
      category: 'pain_consult',
      capture_type: 'pain_consult',
      action: 'reply_only',
      needs_confirmation: false,
      payload: { raw_text: raw },
      reply_text: buildPainConsultReply(raw),
    });
  }

  if (looksLikeBodyMetrics(raw)) {
    const payload = parseBodyMetrics(raw);
    if (payload) {
      return withCompatAliases({
        category: 'body_metrics',
        capture_type: 'body_metrics',
        action: 'needs_confirmation',
        needs_confirmation: true,
        auto_save: false,
        payload,
        reply_text: buildBodyMetricReply(payload),
      });
    }
  }

  if (looksLikeMemoryNote(raw) && !includesAny(normalized, ['保存', '記録', '体重', '体脂肪'])) {
    const memory = buildMemoryPayload(raw);
    return withCompatAliases({
      category: 'memory_note',
      capture_type: 'memory_note',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: memory.payload,
      memory_candidates: memory.memory_candidates,
      reply_text: buildMemoryReply(raw),
    });
  }

  return null;
}

function extractReplyTextFromRouterResult(routerResult = null) {
  if (!routerResult || typeof routerResult !== 'object') return '';
  return safeText(
    routerResult.reply_text ||
      routerResult.replyText ||
      routerResult.assistant_reply ||
      routerResult.text ||
      ''
  );
}

function normalizeRouterResult(routerResult = null, userText = '') {
  if (!routerResult || typeof routerResult !== 'object') return null;

  const route = safeText(routerResult.route || '');
  const category = safeText(
    routerResult.category ||
      routerResult.intent ||
      routerResult.route ||
      routerResult.type ||
      ''
  );

  const replyText = extractReplyTextFromRouterResult(routerResult);
  const topRecordCandidate =
    routerResult.top_record_candidate ||
    routerResult.record_candidate ||
    routerResult.recordCandidate ||
    null;

  if (category === 'pain_consult' || category === 'consultation') {
    return withCompatAliases({
      category: 'pain_consult',
      capture_type: 'pain_consult',
      action: 'reply_only',
      needs_confirmation: false,
      payload: routerResult.payload || { raw_text: safeText(userText) },
      reply_text: buildPainConsultReply(userText),
      meta: routerResult.meta || {},
      raw: routerResult,
    });
  }

  if (category === 'smalltalk') {
    return withCompatAliases({
      category: 'general_consult',
      capture_type: 'general_consult',
      action: 'reply_only',
      needs_confirmation: false,
      payload: routerResult.payload || { raw_text: safeText(userText) },
      reply_text: replyText,
      meta: routerResult.meta || {},
      raw: routerResult,
    });
  }

  if (category === 'memory_note') {
    const memory = buildMemoryPayload(userText);
    return withCompatAliases({
      category: 'memory_note',
      capture_type: 'memory_note',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: routerResult.payload || memory.payload,
      memory_candidates: Array.isArray(routerResult.memory_candidates) && routerResult.memory_candidates.length
        ? routerResult.memory_candidates
        : memory.memory_candidates,
      reply_text: replyText || buildMemoryReply(userText),
      meta: routerResult.meta || {},
      raw: routerResult,
    });
  }

  if (category === 'meal_record' || category === 'exercise_record') {
    return withCompatAliases({
      category,
      capture_type: category,
      action: safeText(routerResult.action || 'needs_confirmation'),
      needs_confirmation: routerResult.needs_confirmation !== false,
      auto_save: Boolean(routerResult.auto_save),
      payload: routerResult.payload || {},
      record_candidate: routerResult.record_candidate || topRecordCandidate || null,
      reply_text: replyText,
      meta: routerResult.meta || {},
      raw: routerResult,
    });
  }

  if (category === 'body_metrics') {
    const payload = parseBodyMetrics(userText) || routerResult.payload || {};
    return withCompatAliases({
      category: 'body_metrics',
      capture_type: 'body_metrics',
      action: 'needs_confirmation',
      needs_confirmation: true,
      auto_save: false,
      payload,
      reply_text: buildBodyMetricReply(payload),
      meta: routerResult.meta || {},
      raw: routerResult,
    });
  }

  if (topRecordCandidate) {
    const built = buildRecordCaptureResult(topRecordCandidate);
    if (built) {
      if (!built.reply_text && replyText) built.reply_text = replyText;
      built.raw = routerResult;
      return withCompatAliases(built);
    }
  }

  if (route === 'consultation') {
    return withCompatAliases({
      category: 'general_consult',
      capture_type: 'general_consult',
      action: 'reply_only',
      needs_confirmation: false,
      payload: { raw_text: safeText(userText) },
      reply_text: replyText,
      meta: routerResult.meta || {},
      raw: routerResult,
    });
  }

  return null;
}

async function analyzeWithRouter(args = {}) {
  if (typeof routeConversation !== 'function') return null;

  try {
    const result = await routeConversation({
      user: args.user || null,
      currentUserText: safeText(args.userText || args.currentUserText || args.text || ''),
      recentMessages: Array.isArray(args.recentMessages) ? args.recentMessages : [],
      profileSummary: safeText(args.profileSummary || ''),
    });

    return normalizeRouterResult(result, args.userText || args.currentUserText || args.text || '');
  } catch (_err) {
    return null;
  }
}

async function analyzeChatCapture({
  userText = '',
  user = null,
  text = '',
  currentUserText = '',
  recentMessages = [],
  profileSummary = '',
  companionMemory = [],
  pendingCapture = null,
} = {}) {
  const raw = safeText(userText || currentUserText || text);
  if (!raw) return null;

  const priorityResult = buildPriorityCaptureResult(raw);
  if (priorityResult) return priorityResult;

  const routerResult = await analyzeWithRouter({
    userText: raw,
    user,
    text,
    currentUserText,
    recentMessages,
    profileSummary,
    companionMemory,
    pendingCapture,
  });
  if (routerResult) return withCompatAliases(routerResult);

  const candidate = getTopRecordCandidate(raw);
  if (candidate) {
    const recordResult = buildRecordCaptureResult(candidate);
    if (recordResult) return withCompatAliases(recordResult);
  }

  return null;
}

module.exports = {
  analyzeChatCapture,
  normalizeText,
  parseNumber,
  extractAllNumbers,
  parseBodyMetrics,
  buildBodyMetricReply,
  looksLikeConsultation,
  looksLikePainConsultation,
  looksLikeMemoryNote,
  looksLikeBodyMetrics,
  buildMemoryPayload,
  buildMemoryReply,
  buildRecordCaptureResult,
  buildPainConsultReply,
  withCompatAliases,
};
