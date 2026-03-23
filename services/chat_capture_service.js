**'use strict';

 * services/chat_capture_service.js
 *
 * 互換修正版:
 * - 既存 index.js から呼ばれている analyzeChatCapture を残す
 * - 新しい補助関数群もそのまま使える
 * 最終微修正版:
 * - index.js 互換を優先
 * - 既存側が見ていそうなキー名を広めに返す
 * - body_metrics / meal_record / exercise_record / memory_note / pain_consult を返せる
 * - chatgpt_conversation_router が使える時は活かし、使えない時は安全にフォールバック
 */

const { safeText } = require('./chat_context_service');
const { routeConversation } = require('./chatgpt_conversation_router');
let routeConversation = null;
try {
  ({ routeConversation } = require('./chatgpt_conversation_router'));
} catch (_err) {
  routeConversation = null;
}

function summarizeUserState(user = {}) {
  if (!user || typeof user !== 'object') return '';
let recordCandidateService = {};
try {
  recordCandidateService = require('./record_candidate_service');
} catch (_err) {
  recordCandidateService = {};
}

  const parts = [];
  if (user.display_name) parts.push(`名前: ${safeText(user.display_name)}`);
  if (user.nickname) parts.push(`呼び名: ${safeText(user.nickname)}`);
  if (user.goal) parts.push(`目標: ${safeText(user.goal)}`);
  if (user.purpose) parts.push(`目的: ${safeText(user.purpose)}`);
  if (user.ai_tone_label) parts.push(`AIトーン: ${safeText(user.ai_tone_label)}`);
  if (user.trial_status) parts.push(`体験状況: ${safeText(user.trial_status)}`);
  if (user.current_plan) parts.push(`プラン: ${safeText(user.current_plan)}`);
  return parts.join(' / ');
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

function buildRecentConversationMemo(recentMessages = []) {
  const list = Array.isArray(recentMessages) ? recentMessages.slice(-6) : [];
  const lines = [];
function safeText(value, fallback = '') {
  if (typeof recordNormalizerService.safeText === 'function') {
    try {
      return recordNormalizerService.safeText(value, fallback);
    } catch (_err) {}
  }
  return String(value || fallback).trim();
}

  for (const item of list) {
    const role = safeText(item.role) === 'assistant' ? 'AI' : '利用者';
    const text = safeText(item.text || item.message || item.body || '');
    if (!text) continue;
    lines.push(`${role}: ${text}`);
function normalizeRecordCandidate(raw = {}) {
  if (typeof recordNormalizerService.normalizeRecordCandidate === 'function') {
    try {
      return recordNormalizerService.normalizeRecordCandidate(raw);
    } catch (_err) {}
  }

  return lines.join('\n').trim();
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

function buildCompanionMemorySnippet({
  user = {},
  recentMessages = [],
  latestRoute = '',
  latestSummary = '',
  latestRecordCandidate = null,
} = {}) {
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

  const userState = summarizeUserState(user);
  if (userState) parts.push(`利用者情報\n${userState}`);
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
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const payload = {};
  const rounded = (value) => Math.round(Number(value) * 10) / 10;

  const convo = buildRecentConversationMemo(recentMessages);
  if (convo) parts.push(`直前会話\n${convo}`);
  const takeWeight = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 20 && n <= 300) payload.weight_kg = rounded(n);
  };

  if (latestRoute) parts.push(`直前の会話分類\n${safeText(latestRoute)}`);
  if (latestSummary) parts.push(`今回の要点\n${safeText(latestSummary)}`);
  const takeBodyFat = (value) => {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 1 && n <= 80) payload.body_fat_percent = rounded(n);
  };

  if (latestRecordCandidate?.type) {
    parts.push(
      `記録候補\n` +
      `種類: ${safeText(latestRecordCandidate.type)}\n` +
      `要約: ${safeText(latestRecordCandidate.user_facing_summary)}`
    );
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
  if ((!payload.weight_kg || !payload.body_fat_percent) && numbers.length >= 2 && normalized.includes('体脂肪')) {
    if (!payload.weight_kg) takeWeight(numbers[0]);
    if (!payload.body_fat_percent) takeBodyFat(numbers[1]);
  }

  return parts.join('\n\n').trim();
  if (!payload.weight_kg && !payload.body_fat_percent && numbers.length === 1) {
    const value = numbers[0];
    if (/%|％/.test(text) || /(体脂肪|パーセント|ぱーせんと|パー|ぱー)/.test(text)) {
      takeBodyFat(value);
    } else if (/(kg|キロ)/i.test(text) || normalized.includes('体重') || (value >= 20 && value <= 300)) {
      takeWeight(value);
    }
  }

  if (!payload.weight_kg && !payload.body_fat_percent) return null;
  return payload;
}

function buildAssistantReplyGuard({
  latestRoute = '',
  isAmbiguous = false,
  shouldAvoidSales = false,
  shouldAvoidRecordPush = false,
} = {}) {
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
    latestRoute: safeText(latestRoute),
    isAmbiguous: Boolean(isAmbiguous),
    shouldAvoidSales: Boolean(shouldAvoidSales),
    shouldAvoidRecordPush: Boolean(shouldAvoidRecordPush),
    rules: [
      shouldAvoidSales ? '雑談や相談中はサービス説明へ飛ばしすぎない' : null,
      shouldAvoidRecordPush ? '記録が確定していない時は保存を急がせない' : null,
      isAmbiguous ? '意味が分かれそうな時は会話継続を優先する' : null,
    ].filter(Boolean),
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

function buildNaturalFollowupSuggestion({
  latestRoute = '',
  topicHints = {},
} = {}) {
  if (latestRoute === 'consultation') {
    return '気持ちや状況をもう少しだけ聞きながら寄り添って返す';
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
  if (latestRoute === 'smalltalk') {
    return '無理に記録や案内へ進めず、自然に会話を続ける';

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
  if (latestRoute === 'record_candidate') {
    if (topicHints.hasMealTopic) return '食事記録として整理しつつ、合っているかやさしく確認する';
    if (topicHints.hasExerciseTopic) return '運動記録として整理しつつ、時間や内容をやさしく確認する';
    return '記録候補として整理しつつ、保存を急がせず確認する';

  if (type === 'weight' || type === 'body_fat') {
    return withCompatAliases({
      category: 'body_metrics',
      capture_type: 'body_metrics',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: normalized.parsed_payload || {},
      record_candidate: normalized,
      reply_text:
        safeText(normalized.meta?.reply_text) ||
        buildBodyMetricReply(normalized.parsed_payload || {}),
    });
  }
  if (latestRoute === 'procedure') {
    return '希望する手続きだけを簡潔に案内する';

  if (type === 'blood_test') {
    return withCompatAliases({
      category: 'blood_test',
      capture_type: 'blood_test',
      action: 'needs_confirmation',
      needs_confirmation: true,
      payload: normalized.parsed_payload || {},
      record_candidate: normalized,
      reply_text:
        safeText(normalized.meta?.reply_text) ||
        '血液検査の内容を受け取れています。このまま記録候補として進めて大丈夫ですか？',
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
      return safeText(result || '');
    } catch (_err) {}
  }

  if (typeof painSupportService.buildPainSupportResponse === 'function') {
    try {
      const result = painSupportService.buildPainSupportResponse(raw);
      if (result && typeof result === 'object') {
        return safeText(result.text || result.reply_text || '');
      }
      return safeText(result || '');
    } catch (_err) {}
  }

  return (
    'それは心配ですね。まずは記録より相談として受け取ります。' +
    (raw ? ' 無理を広げず、いつもと違うつらさや強い痛みがある時は、牛込や医療機関にも相談してください。' : '')
  );
}

function withCompatAliases(result = {}) {
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

function buildRouterFallbackResult(userText = '') {
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
        payload,
        reply_text: buildBodyMetricReply(payload),
      });
    }
  }

  const candidate = getTopRecordCandidate(raw);
  if (candidate) {
    const recordResult = buildRecordCaptureResult(candidate);
    if (recordResult) return withCompatAliases(recordResult);
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
      reply_text: replyText || buildPainConsultReply(userText),
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
    return withCompatAliases({
      category: 'body_metrics',
      capture_type: 'body_metrics',
      action: safeText(routerResult.action || 'needs_confirmation'),
      needs_confirmation: routerResult.needs_confirmation !== false,
      auto_save: Boolean(routerResult.auto_save),
      payload: routerResult.payload || {},
      reply_text: replyText || buildBodyMetricReply(routerResult.payload || {}),
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
  return '無理に分類せず、自然に一言聞き返して意味を確かめる';
}

/**
 * 既存互換:
 * index.js から analyzeChatCapture(...) として呼ばれても落ちないようにする
 */
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
  const inputText = safeText(currentUserText || text);
  const raw = safeText(userText || currentUserText || text);
  if (!raw) return null;

  const routed = await routeConversation({
  const routerResult = await analyzeWithRouter({
    userText: raw,
    user,
    currentUserText: inputText,
    text,
    currentUserText,
    recentMessages,
    profileSummary,
    companionMemory,
    pendingCapture,
  });
  if (routerResult) return withCompatAliases(routerResult);

  const latestRoute = routed?.route || 'unknown';
  const topRecordCandidate = routed?.top_record_candidate || null;
  const topicHints = routed?.meta?.topic_hints || {};

  return {
    success: true,
    route: latestRoute,
    category: latestRoute,
    isAmbiguous: Boolean(routed?.is_ambiguous),
    needsClarification: Boolean(routed?.needs_clarification),
    replyText: safeText(routed?.reply_text),
    recordCandidate: topRecordCandidate,
    recordCandidates: Array.isArray(routed?.record_candidates) ? routed.record_candidates : [],
    topicHints,
    followupSuggestion: buildNaturalFollowupSuggestion({
      latestRoute,
      topicHints,
    }),
    memorySnippet: buildCompanionMemorySnippet({
      user,
      recentMessages,
      latestRoute,
      latestSummary: inputText,
      latestRecordCandidate: topRecordCandidate,
    }),
    raw: routed,
  };
  return withCompatAliases(buildRouterFallbackResult(raw));
}

module.exports = {
  summarizeUserState,
  buildRecentConversationMemo,
  buildCompanionMemorySnippet,
  buildAssistantReplyGuard,
  buildNaturalFollowupSuggestion,
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
