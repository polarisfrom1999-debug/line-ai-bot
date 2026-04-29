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
  if (/(今日|本日).*(合計|収支|出納|食べ(た|る|ます|ました)?(くらい|量|の|分|か|？|ですか|だっけ)?|動(いた|き|きます|ます|ました)?(くらい|量|の|分|か|？|ですか|だっけ)?|ど(の|な)くらい|運動|歩(いた|数|行)?|活動(量|量は|消費)?(くらい|どれ)?|摂取(量|は|した)?(くらい|いくら)?)/.test(
    safe
  )) {
    return false;
  }
  if (/(今週|週間|この(一|1)週間|直近(7|７)日(間|ぶり|分)?(の|のあたり|は|で|って|で)?(まとめ|報告|ふり返|振り返|サマリ|サマリー|収支|出納|食べ|活動|状況|所見|どう|レポート|バランス)|7日(間|分|ぶり)?(の|は|で|って|のあたり)?(まとめ|報告|ふり返|振り返|サマリ|サマリー|状況|どう))/.test(
    safe
  )) {
    return false;
  }
  if (/(傾向|推移|傾向(と|)(対策|対応)|対策(を)?(教|聞)|気をつける(こと|点|べき)|他の日付|他の検査日|何日分(\s*(ある|です|か|？)|ある|です|か)|保存.*(何件|いくつ)|前回より|前回と比|前回と比較|高い数値|低い数値|異常は|異常ある|バランスは|バランスどう)/.test(safe)) {
    return false;
  }
  if (/(この(検査)?結果.*どう|この結果.*どう|健康状態どう思う|総評して|全体としてどう|全体的にどう)/i.test(safe)) {
    return false;
  }
  return !/(TG|LDL|HDL|HbA1c|中性脂肪|検査|患者|氏名|クリニック|病院|医療(機関)?|採血|日付|悪い|値|何が|読め|異常|H\/L|高い数値|低い数値|前回より|前回と比|比較|バランス|麺|カロリー|半分|食べてない|0kcal|食事|合計|詳細|内訳|トータル|収支|運動|活動)/i.test(
    safe
  );
}

function inferDomainFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return 'unknown';
  if (/(今週|週間|直近(7|７)日|今日の(合計|収支)|半分食べ|0kcal|食事の合計)/i.test(safe)) return 'meal';
  if (/(TG|LDL|HDL|HbA1c|中性脂肪|検査|患者|氏名|クリニック|病院|採血|日付|悪い|何が|読め|印刷|異常|悪|値|H\/L|変化|推移|傾向|対策|気をつける|他の日付|他の検査日|何日分|前回より|前回と比|前回と比較|高い数値|低い数値|バランス)/i.test(safe)) {
    return 'lab';
  }
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
  const activeType = normalizeText(active?.type || active?.domain || '');
  const hasActiveImageSession = Boolean(
    active?.domain
    && (/_image_session$/.test(activeType) || activeType === 'lab_image_session_failed')
  );
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
    if (/^lab_image_session_failed/.test(normalizeText(active.type || active.domain || ''))) {
      return {
        intentType: 'newflow_lab_followup_blocked_after_failed_ingest',
        replyText: '直前の検査画像はまだ取り込めていないため、過去データでは回答しません。画像を撮り直して再送してください。'
      };
    }
    if (/^lab_/.test(normalizeText(active.type || active.domain || ''))) {
      let panel = active?.payload?.labPanel || null;
      const sessionLabReached = true;
      let canonicalLabReached = false;
      const currentSessionId = active?.payload?.labSessionId || null;
      let answerSourceSessionId = currentSessionId || null;
      if (isWeakLabPanel(panel)) {
        const canonical = await canonicalFallbackService.getCanonicalLabPanel(input.userId, { logReachability: false });
        if (canonical) {
          panel = mergeLabPanels(panel, canonical);
          canonicalLabReached = true;
          answerSourceSessionId = canonical?.sourceSessionId || answerSourceSessionId;
        }
      }
      return await resolveLabFollowup(safeText, panel, {
        userId: input.userId,
        sessionLabReached,
        canonicalLabReached,
        currentSessionId,
        answerSourceSessionId
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
        return await resolveLabFollowup(safeText, panel, {
          userId: input.userId,
          sessionLabReached: false,
          canonicalLabReached: true,
          currentSessionId: null,
          answerSourceSessionId: panel?.sourceSessionId || null
        });
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
        return await resolveLabFollowup(safeText, panel, {
          userId: input.userId,
          sessionLabReached: false,
          canonicalLabReached: true,
          currentSessionId: null,
          answerSourceSessionId: panel?.sourceSessionId || null
        });
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
