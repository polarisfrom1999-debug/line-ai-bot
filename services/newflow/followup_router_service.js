'use strict';

const activeContextStoreService = require('./active_context_store_service');
const responseBuilderService = require('./response_builder_service');
const canonicalFallbackService = require('./canonical_fallback_service');
const { resolveLabFollowup } = require('./resolvers/lab_followup_resolver_service');
const { resolveMealFollowup, resolveCanonicalMealFollowup } = require('./resolvers/meal_followup_resolver_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function looksLikeGeneralConversation(text) {
  const safe = normalizeText(text);
  if (!safe) return true;
  return !/(TG|LDL|HDL|HbA1c|検査|患者名|クリニック|麺|カロリー|半分|食べてない|0kcal|食事)/i.test(safe);
}

function inferDomainFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return 'unknown';
  if (/(TG|LDL|HDL|HbA1c|検査|患者名|クリニック|採血|印刷日|異常|変化|推移)/i.test(safe)) return 'lab';
  if (/(食事|麺|カロリー|半分|食べてない|0kcal|削除できた|削除した|補正)/i.test(safe)) return 'meal';
  return 'unknown';
}

/**
 * Phase A skeleton:
 * - active context は必ず active_context_store_service 経由で1件取得
 * - shortMemory / 旧context helper には依存しない
 * - 実際の回答生成は次フェーズで実装
 */
async function resolveFollowup({ input, text, imageFollowupOnly = true } = {}) {
  const safeText = normalizeText(text || input?.rawText || '');
  if (!safeText || input?.messageType !== 'text') return null;

  const status = await activeContextStoreService.getActiveContext(input?.userId);
  const active = status?.context;
  const hasActiveImageSession = Boolean(active?.domain && /_image_session$/.test(normalizeText(active.type || active.domain || '')));
  if (hasActiveImageSession) {
    const isGeneral = looksLikeGeneralConversation(safeText);
    if (imageFollowupOnly && isGeneral) return null;
  }

  // 1) active session 有効なら session参照（最優先）
  if (hasActiveImageSession && !status?.expired) {
    if (/^lab_/.test(normalizeText(active.type || active.domain || ''))) {
      return resolveLabFollowup(safeText, active?.payload?.labPanel || null);
    }
    if (/^meal_/.test(normalizeText(active.type || active.domain || ''))) {
      return resolveMealFollowup({ input, text: safeText, activeContext: active });
    }
    return null;
  }

  // 2) session がTTL切れなら canonical参照
  if (status?.expired) {
    const inferred = inferDomainFromText(safeText);
    if (inferred === 'lab') {
      const panel = await canonicalFallbackService.getCanonicalLabPanel(input?.userId);
      if (panel) return resolveLabFollowup(safeText, panel);
      return { intentType: 'newflow_context_expired', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
    }
    if (inferred === 'meal') {
      const canonicalMeal = await canonicalFallbackService.getCanonicalMeal(input?.userId);
      const mealReply = resolveCanonicalMealFollowup(safeText, canonicalMeal);
      if (mealReply?.replyText) return mealReply;
      return { intentType: 'newflow_context_expired', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
    }
    return {
      intentType: 'newflow_context_expired',
      replyText: responseBuilderService.buildTtlExpiredReply()
    };
  }

  // 3) active なしでも canonicalで答えられるものは答える
  const inferred = inferDomainFromText(safeText);
  if (inferred === 'lab') {
    const panel = await canonicalFallbackService.getCanonicalLabPanel(input?.userId);
    if (panel) return resolveLabFollowup(safeText, panel);
    return { intentType: 'newflow_canonical_insufficient', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
  }
  if (inferred === 'meal') {
    const canonicalMeal = await canonicalFallbackService.getCanonicalMeal(input?.userId);
    const mealReply = resolveCanonicalMealFollowup(safeText, canonicalMeal);
    if (mealReply?.replyText) return mealReply;
    return { intentType: 'newflow_canonical_insufficient', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
  }
  return null;
}

module.exports = {
  resolveFollowup,
};
