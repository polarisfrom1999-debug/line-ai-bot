'use strict';

const activeContextStoreService = require('./active_context_store_service');
const responseBuilderService = require('./response_builder_service');
const canonicalFallbackService = require('./canonical_fallback_service');
const { resolveLabFollowup, mergeLabPanels, isWeakLabPanel } = require('./resolvers/lab_followup_resolver_service');
const { resolveMealFollowup, resolveCanonicalMealFollowup } = require('./resolvers/meal_followup_resolver_service');
const phaseeReachabilityService = require('../phasee_reachability_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function looksLikeGeneralConversation(text) {
  const safe = normalizeText(text);
  if (!safe) return true;
  return !/(TG|LDL|HDL|HbA1c|中性脂肪|検査|患者|氏名|クリニック|病院|医療(機関)?|採血|日付|悪い|値|何が|読め|異常|H\/L|麺|カロリー|半分|食べてない|0kcal|食事)/i.test(safe);
}

function inferDomainFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return 'unknown';
  if (/(TG|LDL|HDL|HbA1c|中性脂肪|検査|患者|氏名|クリニック|病院|採血|日付|悪い|何が|読め|印刷|異常|悪|値|H\/L|変化|推移)/i.test(safe)) return 'lab';
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
  console.info('[phasee-new] new_followup_router_reached', { userId: input?.userId || '', text: safeText.slice(0, 60) });
  phaseeReachabilityService.recordReachability('new_followup_router_reached', ['services/newflow/followup_router_service.js'], {
    userId: input?.userId || '',
    text: safeText.slice(0, 60)
  }).catch(() => null);

  const status = await activeContextStoreService.getActiveContext(input?.userId);
  const active = status?.context;
  const hasActiveImageSession = Boolean(active?.domain && /_image_session$/.test(normalizeText(active.type || active.domain || '')));
  if (hasActiveImageSession) {
    const isGeneral = looksLikeGeneralConversation(safeText);
    if (imageFollowupOnly && isGeneral) {
      return {
        intentType: 'newflow_followup_block_legacy',
        replyText: '前の画像の続きとして扱います。確認したい内容を短く指定してください（例: TGは？ / 半分食べた）。',
        blockLegacyFollowup: true
      };
    }
  }

  // 1) active session 有効なら session参照（最優先）
  if (hasActiveImageSession && !status?.expired) {
    if (/^lab_/.test(normalizeText(active.type || active.domain || ''))) {
      let panel = active?.payload?.labPanel || null;
      const sessionLabReached = true;
      let canonicalLabReached = false;
      if (isWeakLabPanel(panel)) {
        const canonical = await canonicalFallbackService.getCanonicalLabPanel(input.userId, { logReachability: false });
        if (canonical) {
          panel = mergeLabPanels(panel, canonical);
          canonicalLabReached = true;
        }
      }
      return resolveLabFollowup(safeText, panel, {
        userId: input.userId,
        sessionLabReached,
        canonicalLabReached
      });
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
      if (panel) {
        return resolveLabFollowup(safeText, panel, { userId: input.userId, sessionLabReached: false, canonicalLabReached: true });
      }
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
    if (panel) {
      return resolveLabFollowup(safeText, panel, { userId: input.userId, sessionLabReached: false, canonicalLabReached: true });
    }
    return { intentType: 'newflow_canonical_insufficient', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
  }
  if (inferred === 'meal') {
    const canonicalMeal = await canonicalFallbackService.getCanonicalMeal(input?.userId);
    const mealReply = resolveCanonicalMealFollowup(safeText, canonicalMeal);
    if (mealReply?.replyText) return mealReply;
    return { intentType: 'newflow_canonical_insufficient', replyText: responseBuilderService.buildCanonicalInsufficientReply() };
  }
  if (imageFollowupOnly) {
    return {
      intentType: 'newflow_followup_block_legacy',
      replyText: '前の画像の続きとして扱うため、確認したい項目を短く指定してください。',
      blockLegacyFollowup: true
    };
  }
  return null;
}

module.exports = {
  resolveFollowup,
};
