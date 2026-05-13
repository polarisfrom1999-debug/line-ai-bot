'use strict';

/** @see scripts/simulate_line_harness.js — 禁止テンプレ */
const GENERIC_TEMPLATE_STRIP = [
  'ここまでの流れを一本で見ています',
  '急がず、今日はこの一歩で十分です',
  '雑談も、ちゃんと受け止めます',
  '健康の話に引き戻さなくて大丈夫です',
  '続きがあれば、そのまま送ってください',
  'まずはここに送れただけで十分です'
];

const BANNED_SHORT_PHRASES = [
  '記録しました',
  '確認しました',
  '保存しました',
  'いい流れです',
  '無理なく続けましょう',
  '頑張りましょう',
  '次の一歩は小さくて十分です'
];

function forbiddenPhraseHits(text) {
  const t = String(text || '');
  const hits = [];
  for (const s of GENERIC_TEMPLATE_STRIP) {
    if (t.includes(s)) hits.push(s);
  }
  for (const s of BANNED_SHORT_PHRASES) {
    if (t.includes(s)) hits.push(s);
  }
  if (/「[^」]{1,48}」の重さ、ちゃんと受け取っています/.test(t)) hits.push('echo_weight_lead_template');
  return hits;
}

function normalizeForEcho(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[、,，]/g, '')
    .toLowerCase();
}

function hasDirectEcho(userText, reply) {
  const ut = normalizeForEcho(userText);
  const rt = normalizeForEcho(reply);
  if (ut.length < 2) return true;
  if (/おはぎ|お萩/.test(String(userText || '')) && /おはぎ|お萩/.test(String(reply || ''))) return true;
  const chunks = String(userText || '')
    .split(/[,、，\s]+/)
    .map((x) => normalizeForEcho(x))
    .filter((x) => x.length >= 2);
  for (const c of chunks) {
    if (c.length >= 2 && rt.includes(c)) return true;
  }
  if (ut.length >= 4 && rt.includes(ut.slice(0, Math.min(12, ut.length)))) return true;
  return false;
}

function hasEmotionalDepth(reply) {
  const t = String(reply || '');
  if (t.length >= 140) return true;
  return /寄り添|受け止|大丈夫|一緒に|そっと|重い|気持ち|つらい|しんど|聞いてい|ここで|呼吸|ペース|無理に/.test(t);
}

function hasEmotionalAnchor(userText, reply) {
  const u = String(userText || '');
  const r = String(reply || '');
  if (!/心が重|気持ちが重|重いです|つら|しんど|寂|不安|苦し/.test(u)) return true;
  return /重|つら|しんど|気持ち|寄り添|受け止|大丈夫|呼吸|ペース|ここで|横で|聞いてい/.test(r);
}

function hasExerciseBodyCue(reply) {
  return /ストレッチ|腕|身体|伸び|変化|感じ|捻れ|ほぐ|動き|肩|背中|可動|筋/.test(String(reply || ''));
}

function hasRewardBlame(reply) {
  return /(反省|禁物|だめだ|ダメだ|やりすぎ|減点|最悪|失敗した|叱|罰)/.test(String(reply || ''));
}

function hasUnauthorizedStabilityClaim(reply) {
  return /安定してきています|かなり安定して|朝の形として安定しています|朝の形として安定してきて/.test(String(reply || ''));
}

function hasCasualOnlyMeal(reply) {
  const t = String(reply || '');
  const mealCue = /手入力|目安|kcal|カロリー|食事|卵|白湯|ご飯|味噌|おはぎ/.test(t);
  return !mealCue;
}

/**
 * @returns {string[]} violation messages
 */
function evaluateReplyQuality({
  userText = '',
  reply = '',
  intentType = '',
  interpretMode = '',
  replyDepth = '',
  allowStableRoutinePhrase = false
} = {}) {
  const violations = [];
  const hits = forbiddenPhraseHits(reply);
  if (hits.length) violations.push(`forbidden_template:${hits.join('|')}`);

  if (!String(reply || '').trim()) violations.push('empty_reply');

  if (intentType === 'pending_confirmation') {
    if (!/同じ内容|追加|もう一度/.test(String(reply || ''))) violations.push('pending_confirmation_vague');
    return violations;
  }

  if (intentType === 'casual_chat') {
    if (!/続き|送って|別の話|大丈夫/.test(String(reply || ''))) violations.push('casual_ack_weak');
    return violations;
  }

  if (intentType === 'lab_followup') {
    if (!/(TG|中性脂肪|検査|データ|画像|読み取り)/i.test(String(reply || ''))) {
      violations.push('lab_followup_no_anchor');
    }
    if (/手入力の目安|今日の合計/.test(reply)) violations.push('lab_meal_bleed');
    return violations;
  }

  if (intentType === 'lab_date_inventory') {
    if (!/(検査日|日付|保存|確認)/.test(String(reply || ''))) {
      violations.push('lab_date_inventory_no_anchor');
    }
    if (/(患者名|医療機関|印刷日)/.test(reply)) violations.push('lab_date_inventory_meta_bloat');
    if (/手入力の目安|今日の合計/.test(reply)) violations.push('lab_meal_bleed');
    return violations;
  }

  if (intentType === 'life_companion') {
    if (!/(聞い|しんど|つら|大丈夫|教えて|場面|感じ|なるほど|そう|嫌)/.test(String(reply || ''))) {
      violations.push('life_companion_shallow');
    }
    if (/(手入力の目安|今日の合計|kcal)/i.test(reply)) violations.push('life_companion_health_bleed');
    return violations;
  }

  if (/^meal_correction/.test(intentType) || intentType === 'meal_correction_target_not_found') {
    if (!/(食事|ご飯|半分|記録|直前)/.test(String(reply || ''))) violations.push('meal_correction_not_grounded');
    return violations;
  }

  if (intentType === 'emotional_support') {
    if (!hasEmotionalAnchor(userText, reply)) violations.push('emotional_no_anchor');
    if (replyDepth === 'deep' && !hasEmotionalDepth(reply)) violations.push('emotional_support_shallow');
    return violations;
  }

  if (intentType === 'correction_feedback') {
    if (!/(すみません|ごめん|失礼|訂正|見直し|ずれ|ズレ)/.test(String(reply || ''))) {
      violations.push('correction_feedback_no_apology');
    }
    if (/ひとりで抱えすぎ|一緒に整理していきましょう|抱えすぎなくて大丈夫|今わかる範囲だけで/.test(reply)) {
      violations.push('correction_feedback_extra_companion');
    }
    if (String(reply || '').length > 420) violations.push('correction_feedback_too_long');
    return violations;
  }

  if (intentType === 'exercise_feedback') {
    if (!hasExerciseBodyCue(reply)) violations.push('exercise_feedback_no_body_cue');
    if (/ストレッチ|腕/.test(userText) && !/(ストレッチ|腕|伸び|肩|背中|身体|可動|筋)/.test(reply)) {
      violations.push('exercise_feedback_no_body_cue');
    }
    if (/^なるほど。今の感じは受け取れた/.test(reply)) violations.push('exercise_feedback_generic_escape');
    return violations;
  }

  if (intentType === 'meal_note') {
    if (hasRewardBlame(reply)) violations.push('reward_food_blame');
    if (hasCasualOnlyMeal(reply)) violations.push('meal_treated_as_casual');
    if (/おはぎ/.test(userText) && !/おはぎ/.test(reply)) violations.push('reward_food_no_echo');
    if (!hasDirectEcho(userText, reply)) violations.push('no_direct_echo');
    if (!allowStableRoutinePhrase && hasUnauthorizedStabilityClaim(reply)) {
      violations.push('stable_routine_without_evidence');
    }
    return violations;
  }

  if (intentType === 'meal_record_text' || intentType === 'meal_text') {
    if (hasCasualOnlyMeal(reply)) violations.push('meal_treated_as_casual');
    if (!hasDirectEcho(userText, reply) && !/(白湯|卵|手入力の目安|kcal)/.test(reply)) {
      violations.push('no_direct_echo');
    }
    if (!allowStableRoutinePhrase && hasUnauthorizedStabilityClaim(reply)) {
      violations.push('stable_routine_without_evidence');
    }
    return violations;
  }

  if (!hasDirectEcho(userText, reply)) violations.push('no_direct_echo');

  return violations;
}

module.exports = {
  evaluateReplyQuality,
  forbiddenPhraseHits,
};
