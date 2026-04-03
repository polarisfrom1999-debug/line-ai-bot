'use strict';

const contextMemoryService = require('./context_memory_service');
const { parseDisplayName } = require('../parsers/name_parser');

let supabase = null;
let ensureUser = null;
try {
  ({ supabase } = require('./supabase_service'));
  ({ ensureUser } = require('./user_service'));
} catch (_error) {
  supabase = null;
  ensureUser = null;
}

const recentInsertCache = new Map();
const CACHE_LIMIT = 50;

const BODY_PARTS = ['腰', '膝', '首', '肩', '背中', '足首', '股関節', '太もも', 'ふくらはぎ', 'アキレス', '足裏', '肘', '手首'];
const ALLOWED_TYPES = new Set([
  'preferred_name',
  'goal',
  'competition',
  'support_preference',
  'pain_pattern',
  'body_signal',
  'obstacle',
  'life_context',
  'health_priority'
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function compactText(value, max = 180) {
  const safe = normalizeText(value).replace(/\s+/g, ' ');
  return safe.length <= max ? safe : `${safe.slice(0, max - 1)}…`;
}

function normalizeLoose(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function isQuestionLike(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /[？?]$/.test(safe) || /^(私の名前は|名前は|体重覚えてる|何を覚えてる|覚えてる|血液検査の結果覚えてる)/.test(safe);
}

function includesAny(text, patterns) {
  const safe = normalizeLoose(text);
  return patterns.some((pattern) => safe.includes(normalizeLoose(pattern)));
}

function buildCacheKey(userId, memoryType, content) {
  return `${userId}::${memoryType}::${normalizeLoose(content)}`;
}

function rememberCache(key) {
  const current = recentInsertCache.get('recent') || [];
  current.push(key);
  recentInsertCache.set('recent', current.slice(-CACHE_LIMIT));
}

function hasRecentCache(key) {
  const current = recentInsertCache.get('recent') || [];
  return current.includes(key);
}

async function resolvePersistentUser(lineUserId) {
  if (!supabase || !ensureUser || !lineUserId) return null;
  try {
    return await ensureUser(supabase, lineUserId, 'Asia/Tokyo');
  } catch (_error) {
    return null;
  }
}

function extractPreferredName(text) {
  const safe = normalizeText(text);
  if (!safe || isQuestionLike(safe)) return null;
  return parseDisplayName(safe) || null;
}

function extractGoal(text) {
  const safe = normalizeText(text);
  if (!safe || isQuestionLike(safe)) return null;
  const match = safe.match(/(?:目標は|目標が|目標)\s*([^。！？\n]{2,40})/);
  return match ? compactText(match[1], 80) : null;
}

function extractCompetition(text) {
  const safe = normalizeText(text);
  const match = safe.match(/(800m|1500m|3000m|5000m|5km|10km|ハーフマラソン|フルマラソン|中距離|短距離|マラソン)/i);
  return match ? compactText(match[1], 40) : null;
}

function extractSupportPreference(text) {
  const safe = normalizeText(text);
  if (includesAny(safe, ['優しく', 'やさしく'])) return 'やさしく受け止めてほしい';
  if (includesAny(safe, ['明るく'])) return '明るく前向きに支えてほしい';
  if (includesAny(safe, ['厳しく', '背中を押して'])) return '必要な時は背中を押してほしい';
  if (includesAny(safe, ['整理して', '理屈', 'はっきり'])) return '状況を整理して分かりやすく示してほしい';
  return null;
}

function extractPainPattern(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const isStableLike = /(やすい|前から|いつも|毎回|ずっと|続く|なりやすい)/.test(safe);
  if (!isStableLike) return null;

  for (const bodyPart of BODY_PARTS) {
    if (safe.includes(bodyPart)) return compactText(`${bodyPart}がつらくなりやすい`, 60);
  }
  return null;
}

function extractBodySignal(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  const patterns = [
    /朝は([^。！？\n]{2,30}出にくい)/,
    /(眠りが浅い)/,
    /(疲れやすい)/,
    /(食べすぎやすい)/,
    /(空腹になりやすい)/,
    /(夜に食べたくなりやすい)/,
  ];

  for (const pattern of patterns) {
    const match = safe.match(pattern);
    if (match) return compactText(match[1], 60);
  }
  return null;
}

function extractObstacle(text) {
  const safe = normalizeText(text);
  const patterns = [
    /(朝はやる気が出にくい)/,
    /(忙しくて続けにくい)/,
    /(夜遅くなりやすい)/,
    /(食事が乱れやすい)/,
    /(運動が続きにくい)/,
  ];
  for (const pattern of patterns) {
    const match = safe.match(pattern);
    if (match) return compactText(match[1], 60);
  }
  return null;
}

function extractLifeContext(text) {
  const safe = normalizeText(text);
  if (includesAny(safe, ['夜勤', '交代勤務'])) return '勤務が不規則';
  if (includesAny(safe, ['子育て'])) return '子育て中';
  if (includesAny(safe, ['大会', 'レース'])) return '競技予定がある';
  return null;
}

function extractHealthPriority(text) {
  const safe = normalizeText(text);
  if (includesAny(safe, ['血糖', 'HbA1c'])) return '血糖コントロールを気にしている';
  if (includesAny(safe, ['LDL', '中性脂肪', 'コレステロール'])) return '脂質バランスを気にしている';
  if (includesAny(safe, ['減量', 'ダイエット'])) return '体重管理を重視している';
  return null;
}

function buildCandidates(text) {
  const safe = normalizeText(text);
  if (!safe || safe.length < 2) return [];

  const candidates = [
    { memoryType: 'preferred_name', content: extractPreferredName(safe) },
    { memoryType: 'goal', content: extractGoal(safe) },
    { memoryType: 'competition', content: extractCompetition(safe) },
    { memoryType: 'support_preference', content: extractSupportPreference(safe) },
    { memoryType: 'pain_pattern', content: extractPainPattern(safe) },
    { memoryType: 'body_signal', content: extractBodySignal(safe) },
    { memoryType: 'obstacle', content: extractObstacle(safe) },
    { memoryType: 'life_context', content: extractLifeContext(safe) },
    { memoryType: 'health_priority', content: extractHealthPriority(safe) },
  ].filter((row) => ALLOWED_TYPES.has(row.memoryType) && normalizeText(row.content));

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.memoryType}:${normalizeLoose(candidate.content)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function existsInDb(userId, memoryType, content) {
  if (!supabase || !userId) return false;
  try {
    const { data, error } = await supabase
      .from('conversation_memories')
      .select('id')
      .eq('user_id', userId)
      .eq('memory_type', memoryType)
      .eq('content', content)
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch (_error) {
    return false;
  }
}

async function persistCandidate({ persistentUser, lineUserId, sourceText, candidate, replyText }) {
  if (!persistentUser?.id || !supabase) return false;
  const cacheKey = buildCacheKey(persistentUser.id, candidate.memoryType, candidate.content);
  if (hasRecentCache(cacheKey)) return false;
  if (await existsInDb(persistentUser.id, candidate.memoryType, candidate.content)) {
    rememberCache(cacheKey);
    return false;
  }

  try {
    const payload = {
      user_id: persistentUser.id,
      memory_type: candidate.memoryType,
      content: candidate.content,
      detail_json: {
        source: 'conversation_curated',
        line_user_id: lineUserId || null,
        assistant_reply: compactText(replyText || '', 500)
      },
      source_text: compactText(sourceText || '', 500)
    };

    await supabase.from('conversation_memories').insert(payload);
    rememberCache(cacheKey);
    return true;
  } catch (error) {
    console.error('[memory_curation_service] persistCandidate error:', error?.message || error);
    return false;
  }
}

async function syncStableFactsToLongMemory(lineUserId, candidates) {
  if (!lineUserId || !Array.isArray(candidates) || !candidates.length) return;

  const patch = {};
  const lifeContext = [];
  const bodySignals = [];
  const exerciseBarrier = [];
  const supportPreference = [];

  for (const candidate of candidates) {
    if (candidate.memoryType === 'preferred_name') patch.preferredName = candidate.content;
    if (candidate.memoryType === 'goal') patch.goal = candidate.content;
    if (candidate.memoryType === 'competition') lifeContext.push(`競技: ${candidate.content}`);
    if (candidate.memoryType === 'life_context') lifeContext.push(candidate.content);
    if (candidate.memoryType === 'body_signal' || candidate.memoryType === 'pain_pattern') bodySignals.push(candidate.content);
    if (candidate.memoryType === 'obstacle') exerciseBarrier.push(candidate.content);
    if (candidate.memoryType === 'support_preference') supportPreference.push(candidate.content);
  }

  if (lifeContext.length) patch.lifeContext = lifeContext;
  if (bodySignals.length) patch.bodySignals = bodySignals;
  if (exerciseBarrier.length) patch.exerciseBarrier = exerciseBarrier;
  if (supportPreference.length) patch.supportPreference = supportPreference;

  if (Object.keys(patch).length) {
    await contextMemoryService.mergeLongMemory(lineUserId, patch).catch(() => null);
  }
}

async function recordStableMemories({ input, result }) {
  const lineUserId = input?.lineUserId || input?.userId || null;
  const sourceText = normalizeText(input?.rawText || '');
  if (!lineUserId || !sourceText || input?.messageType !== 'text') return { inserted: 0, skipped: 0 };
  if (sourceText.length < 2 || isQuestionLike(sourceText)) return { inserted: 0, skipped: 1 };

  const candidates = buildCandidates(sourceText);
  if (!candidates.length) return { inserted: 0, skipped: 1 };

  const persistentUser = await resolvePersistentUser(lineUserId);
  const replyText = Array.isArray(result?.replyMessages)
    ? result.replyMessages.map((m) => normalizeText(m?.text || '')).filter(Boolean).join('\n')
    : '';

  let inserted = 0;
  for (const candidate of candidates) {
    const ok = await persistCandidate({
      persistentUser,
      lineUserId,
      sourceText,
      candidate,
      replyText
    });
    if (ok) inserted += 1;
  }

  if (inserted > 0) {
    await syncStableFactsToLongMemory(lineUserId, candidates);
  }

  return { inserted, skipped: Math.max(0, candidates.length - inserted) };
}

module.exports = {
  recordStableMemories,
  buildCandidates
};
