'use strict';

const contextMemoryService = require('./context_memory_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function inferPatchFromUserText(userText) {
  const t = normalizeText(userText);
  if (!t || t.length < 2) return null;
  const patch = { confidence: 0.12 };

  if (/[\u{1F300}-\u{1FAFF}]/u.test(t) || /(笑|w|W{2,}|🙌|✨|😊|♪)/.test(t)) patch.emojiLover = true;
  if (/(〜|ですぅ|ちゃん|がんばりますっ|やば|めっちゃ)/.test(t)) patch.casualLover = true;
  if (/(恐れ入ります|いつもありがとうございます|拝見|伺い)/.test(t) && t.length > 10) patch.formalLover = true;
  if (/(詳しく|数値|グラフ|推移|kcal|カロリー|糖質|脂質)/.test(t)) patch.wantsDetailedNumbers = true;
  if (/(褒め|ほめ|認め|評価)/.test(t)) patch.respondsToPraise = true;
  if (/(厳し|叱って|本音で|甘やかさない)/.test(t)) patch.prefersStrictTone = true;
  if (/(不安|心配|怖い|落ち着かない|気になる)/.test(t)) patch.anxietyProne = true;
  if (/(細かく|うるさく|言わないで|言い過ぎ)/.test(t)) patch.mealMicroFeedbackSensitive = true;
  if (/(体重|kg|キロ|体脂肪)/.test(t)) patch.weightSensitive = true;
  if (/(おはよう|朝の報告|今朝)/.test(t)) patch.happyMorningReplies = true;
  if (/(家族|主人|夫|妻|子ども|子供|母|父).*(共有|見せ|話した)/.test(t) || /家族に/.test(t)) patch.happyFamilyShare = true;

  const keys = Object.keys(patch).filter((k) => k !== 'confidence');
  const any = keys.some((k) => patch[k] === true);
  return any ? patch : null;
}

/**
 * 利用者発話から会話スタイルを軽く学習し longMemory に蓄積する。
 */
async function applyLightStyleUpdate(userId, userText) {
  const uid = normalizeText(userId);
  if (!uid) return null;
  const incoming = inferPatchFromUserText(userText);
  if (!incoming) return null;
  const next = await contextMemoryService.mergeLongMemory(uid, { conversationStyleProfile: incoming });
  const detected = Object.entries(incoming)
    .filter(([k, v]) => k !== 'confidence' && v === true)
    .map(([k]) => k);
  console.info('[conversation_style_profile_updated]', {
    user_id: uid,
    detected_style: detected.join(',') || '(confidence_only)',
    confidence: next?.conversationStyleProfile?.confidence
  });
  return next?.conversationStyleProfile || null;
}

module.exports = {
  applyLightStyleUpdate,
  inferPatchFromUserText
};
