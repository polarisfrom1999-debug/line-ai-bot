'use strict';

const aiChatService = require('./ai_chat_service');
const replyContextBuilder = require('./reply_context_builder_service');
const mealTextManualRecordService = require('./meal_text_manual_record_service');

function normalizeText(v) {
  return String(v || '').trim();
}

function buildManualNutritionBlock(featureResults = {}) {
  const lines = [];
  const breakdown = Array.isArray(featureResults.breakdownLines)
    ? featureResults.breakdownLines.filter(Boolean)
    : [];
  if (breakdown.length) {
    lines.push(`手入力の目安：${breakdown.join(' / ')}`);
  } else if (Number.isFinite(Number(featureResults.kcal)) && Number(featureResults.kcal) > 0) {
    lines.push(`手入力の目安：約${Math.round(Number(featureResults.kcal))}kcal`);
  }
  const daily = Number(featureResults.dailyTotalKcal);
  if (Number.isFinite(daily) && daily >= 0) {
    lines.push(`今日の合計：約${Math.round(daily)}kcal`);
  }
  return lines.join('\n');
}

function modeSystemInstructions(conversationMode, replyDepth) {
  const cm = normalizeText(conversationMode);
  if (cm === 'emotional_support') {
    return [
      '会話モード: emotional_support（感情の受け止め）',
      '返信は2〜4文。短く自然に。',
      '食事・運動・検査・カロリーには触れない。',
      '定型の安心文・伴走テンプレ・励ましの型を使わない。',
      '必要なら、感情の種類を1つだけ優しく聞く。',
    ].join('\n');
  }
  if (cm === 'correction_feedback' || cm === 'assistant_error_feedback') {
    return [
      '会話モード: correction_feedback（訂正・ズレの謝罪）',
      '謝って、どこを直したいか聞く。2〜3文。',
      '伴走文・整理の提案・抱えすぎ系は禁止。',
    ].join('\n');
  }
  if (cm === 'meal_text_record' || cm === 'meal_record_text') {
    return [
      '会話モード: meal_text_record（手入力食事の記録後）',
      '前半は自然な会話文のみ。ユーザーが書いた品目に直接反応する。',
      '数値行は書かない（システムが後から付ける）。',
      '根拠が2回未満のとき「安定してきています」とは言わない。代わりに整えやすい・軽い朝など。',
      '記録しました・いい流れです等の定型は禁止。',
    ].join('\n');
  }
  if (cm === 'reward_food' || cm === 'meal_note') {
    return [
      '会話モード: reward_food（ご褒美食）',
      '責めない。ご褒美テンプレの繰り返しはしない。',
      '数値行は書かない。',
      '2〜3文で自然に。',
    ].join('\n');
  }
  return [
    `会話モード: ${cm || 'normal'}`,
    `reply_depth: ${replyDepth || 'normal'}`,
    'ChatGPTのLINE会話のように自然に。定型伴走文は禁止。',
  ].join('\n');
}

function fallbackProse(ctx) {
  const ut = normalizeText(ctx.userText);
  const cm = normalizeText(ctx.conversationMode);
  const fr = ctx.featureResults || {};
  const stable = Number(ctx.userContext?.stableRoutineEvidenceCount || fr.stableRoutineEvidenceCount || 0);

  if (cm === 'emotional_support' || /心が重|気持ちが重|つらい|しんど|寂し|不安/.test(ut)) {
    return [
      '心が重いんですね。',
      '今日は無理に整えようとしなくて大丈夫です。',
      '',
      '今いちばん近いのは、疲れ・不安・寂しさ・悔しさのどれですか？',
    ].join('\n');
  }

  if (cm === 'correction_feedback' || cm === 'assistant_error_feedback' || /間違え|違う|ズレ|ずれて/.test(ut)) {
    return [
      'すみません、今の返しはズレていました。',
      '直前の内容を見直します。どこを直したいか、そのまま教えてください。',
    ].join('\n');
  }

  if (cm === 'reward_food' || cm === 'meal_note' || fr.recordKind === 'reward_food') {
    const items = (fr.items || []).join('、') || ut.replace(/食べちゃいました|食べました/g, '').trim();
    const countMatch = ut.match(/(\d+)\s*個/);
    const countHint = countMatch ? `${countMatch[1]}個` : '';
    const label = items || (ut.includes('おはぎ') ? `おはぎ${countHint || ''}` : 'それ');
    return [
      `${label}ですね。`,
      'これは責めなくて大丈夫です。次の食事を少し軽めに戻せれば十分です。',
    ].join('\n');
  }

  if (cm === 'meal_text_record' || cm === 'meal_record_text' || fr.saved) {
    const echoSource = isShortAck(ut) && (fr.items || []).length ? (fr.items || []).join('、') : ut;
    const items = (fr.items || []).join('、') || echoSource;
    const breakfast = mealTextManualRecordService.isBreakfastRoutineContext(
      { items: fr.items },
      ut
    );
    const lines = [`${items}ですね。`];
    if (breakfast && stable >= 2) {
      lines.push('朝の形として、だいぶ落ち着いてきている感じですね。');
    } else if (breakfast || /白湯|卵/.test(ut)) {
      lines.push('軽く始めたい朝には、ちょうど整えやすい形です。');
    } else {
      lines.push('今日の流れの中で、無理のない形として受け止めています。');
    }
    return lines.join('\n');
  }

  if (!ut) return 'うん、届いています。続きがあればそのまま送ってください。';
  return `なるほど、「${ut.slice(0, 40)}」ですね。いまの感じを、そのまま聞かせてください。`;
}

function hasUnauthorizedStabilityInProse(prose, ctx) {
  if (Number(ctx.userContext?.stableRoutineEvidenceCount || ctx.featureResults?.stableRoutineEvidenceCount || 0) >= 2) {
    return false;
  }
  return /安定してきています|かなり安定して|朝の形として安定/.test(String(prose || ''));
}

function hasFoodEcho(userText, prose) {
  const ut = String(userText || '');
  const p = String(prose || '');
  if (/白湯/.test(ut) && /白湯/.test(p)) return true;
  if (/卵/.test(ut) && /卵/.test(p)) return true;
  if (/おはぎ/.test(ut) && /おはぎ/.test(p)) return true;
  if (/ご飯|ごはん/.test(ut) && /ご飯|ごはん/.test(p)) return true;
  const chunks = ut.split(/[,、，\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
  return chunks.some((c) => p.includes(c.slice(0, Math.min(8, c.length))));
}

function isShortAck(userText) {
  return /^(はい|うん|OK|ok|お[kK]|了解)$/i.test(normalizeText(userText));
}

function effectiveUserTextForEcho(ctx) {
  if (isShortAck(ctx.userText) && Array.isArray(ctx.featureResults?.items) && ctx.featureResults.items.length) {
    return ctx.featureResults.items.join('、');
  }
  return ctx.userText || '';
}

function isAcceptableProse(ctx, prose) {
  const text = normalizeText(prose);
  if (text.length < 6) return false;
  const cm = normalizeText(ctx.conversationMode);
  const ut = effectiveUserTextForEcho(ctx);

  if (cm === 'emotional_support') {
    return /重|つら|しんど|気持ち|無理に|大丈夫|疲れ|不安|寂し|悔し/.test(text)
      && !/(kcal|カロリー|手入力の目安|TG|検査)/i.test(text);
  }
  if (cm === 'correction_feedback' || cm === 'assistant_error_feedback') {
    return /(すみません|ごめん|失礼|ズレ|ずれ|訂正|見直)/.test(text)
      && !/ひとりで抱えすぎ|一緒に整理していきましょう/.test(text);
  }
  if (cm === 'meal_text_record' || cm === 'meal_record_text' || cm === 'meal_text') {
    return hasFoodEcho(ut, text) && !hasUnauthorizedStabilityInProse(text, ctx);
  }
  if (cm === 'reward_food' || cm === 'meal_note') {
    return !/(反省|禁物|だめだ|やりすぎ)/.test(text)
      && (hasFoodEcho(ut, text) || /責め|大丈夫|軽め/.test(text));
  }
  return true;
}

async function generateProse(ctx) {
  const modeBlock = modeSystemInstructions(ctx.conversationMode, ctx.replyPolicy?.replyDepth);
  const hints = (ctx.observationHints || [])
    .map((h) => (typeof h === 'string' ? h : h?.hint))
    .filter(Boolean)
    .slice(0, 3);
  const featureSummary = JSON.stringify({
    saved: ctx.featureResults?.saved,
    items: ctx.featureResults?.items,
    recordKind: ctx.featureResults?.recordKind,
    stableRoutineEvidenceCount: ctx.userContext?.stableRoutineEvidenceCount,
  });

  const hiddenContext = [
    '[ここから。自然返信]',
    modeBlock,
    hints.length ? `観察ヒント（使うかは文脈判断・そのまま貼らない）: ${hints.join(' / ')}` : null,
    `処理サマリ: ${featureSummary}`,
    '数値・kcal・今日の合計の行は絶対に書かない（後段で付与）。',
    '禁止: ここまでの流れを一本で見ています / 急がず今日はこの一歩で十分 / 雑談もちゃんと受け止めます / 健康の話に引き戻さなくて大丈夫 / 続きがあればそのまま送ってください / まずはここに送れただけで十分',
  ].filter(Boolean).join('\n');

  const raw = await aiChatService.generateReply({
    userMessage: ctx.userText,
    recentMessages: ctx.userContext?.recentMessages || [],
    responseMode: 'conversation_first',
    energyLevel: ctx.replyPolicy?.replyDepth === 'deep' ? 'low' : 'middle',
    hiddenContext,
    longMemory: ctx.userContext?.longMemory || {},
  });

  const prose = normalizeText(raw);
  if (prose && isAcceptableProse(ctx, prose)) {
    return { prose, source: 'openai' };
  }
  if (prose) {
    console.info('[line_natural_reply_quality_gate]', {
      conversation_mode: ctx.conversationMode,
      rejected_preview: prose.slice(0, 120),
      reason: 'openai_output_failed_mode_gate',
    });
  }
  return { prose: fallbackProse(ctx), source: 'rule_fallback' };
}

function shouldAttachNutritionBlock(conversationMode, featureResults) {
  const cm = normalizeText(conversationMode);
  if (!featureResults?.saved) return false;
  return /meal_text_record|meal_record_text|reward_food|meal_note|meal_text/.test(cm)
    || featureResults.recordKind === 'reward_food'
    || featureResults.recordKind === 'meal_text_record';
}

/**
 * LINE返信文の唯一の生成入口（自然文 + 許可された数値ブロックのみ）。
 */
async function generateNaturalLineReply(params = {}) {
  const ctx = replyContextBuilder.buildReplyContext(params);
  const { prose, source } = await generateProse(ctx);

  let text = prose;
  if (shouldAttachNutritionBlock(ctx.conversationMode, ctx.featureResults)) {
    const numeric = buildManualNutritionBlock(ctx.featureResults);
    if (numeric) text = `${prose}\n\n${numeric}`.trim();
  }

  console.info('[line_natural_reply_generated]', {
    user_id: normalizeText(params.userId || ''),
    conversation_mode: ctx.conversationMode,
    source,
    has_numeric_block: shouldAttachNutritionBlock(ctx.conversationMode, ctx.featureResults),
    text_preview: text.slice(0, 160),
  });

  return {
    text: text.trim(),
    meta: { source, conversationMode: ctx.conversationMode },
  };
}

module.exports = {
  generateNaturalLineReply,
  buildManualNutritionBlock,
  fallbackProse,
};
