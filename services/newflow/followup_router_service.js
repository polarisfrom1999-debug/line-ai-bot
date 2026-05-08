'use strict';

const activeContextStoreService = require('./active_context_store_service');
const responseBuilderService = require('./response_builder_service');
const canonicalFallbackService = require('./canonical_fallback_service');
const { resolveLabFollowup, mergeLabPanels, isWeakLabPanel } = require('./resolvers/lab_followup_resolver_service');
const { resolveMealFollowup, resolveCanonicalMealFollowup } = require('./resolvers/meal_followup_resolver_service');
const phaseeReachabilityService = require('../phasee_reachability_service');
const labSessionRepository = require('../../repositories/lab_session_repository');
const { mergeLabPanelsCanonicalItemsWin } = require('./lab_panel_merge_service');

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
  if (/(傾向|推移|傾向(と|)(対策|対応)|対策(を)?(教|聞)|気をつける(こと|点|べき)|他の日付|他の日は|他の検査日|何日分(\s*(ある|です|か|？)|ある|です|か)|保存.*(何件|いくつ)|前回より|前回と比|前回と比較|高い数値|低い数値|異常は|異常ある|バランスは|バランスどう)/.test(safe)) {
    return false;
  }
  if (/(何読み取れた|何を読み取った|全部教えて|どの項目が保存された|読み取れた項目を見せて|保存項目)/.test(safe)) {
    return false;
  }
  if (/(この(検査)?結果.*どう|この結果.*どう|健康状態どう思う|総評して|全体としてどう|全体的にどう)/i.test(safe)) {
    return false;
  }
  return !/(TG|LDL|HDL|HbA1c|LDH|AST|ALT|γ-GTP|GGT|CPK|CK|中性脂肪|血糖|尿酸|クレアチニン|ヘモグロビン|白血球|eGFR|検査|患者|氏名|クリニック|病院|医療(機関)?|採血|日付|悪い|値|何が|読め|異常|H\/L|高い数値|低い数値|前回より|前回と比|比較|バランス|麺|カロリー|半分|食べてない|0kcal|食事|合計|詳細|内訳|トータル|収支|運動|活動)/i.test(
    safe
  );
}

function logLabFollowupSessionValidationChoice(payload = {}) {
  console.info('[phasee-new] lab_followup_session_validation_choice', payload);
}

function inferDomainFromText(text) {
  const safe = normalizeText(text);
  if (!safe) return 'unknown';
  if (/(今週|週間|直近(7|７)日|今日の(合計|収支)|半分食べ|0kcal|食事の合計)/i.test(safe)) return 'meal';
  if (/(TG|LDL|HDL|HbA1c|LDH|AST|ALT|γ-GTP|GGT|CPK|CK|中性脂肪|血糖|尿酸|クレアチニン|ヘモグロビン|白血球|eGFR|検査|患者|氏名|クリニック|病院|採血|日付|悪い|何が|読め|印刷|異常|悪|値|H\/L|変化|推移|傾向|対策|気をつける|他の日付|他の日は|他の検査日|何日分|前回より|前回と比|前回と比較|高い数値|低い数値|バランス|全部教えて|保存項目)/i.test(safe)) {
    return 'lab';
  }
  if (/(食事|麺|カロリー|半分|食べてない|0kcal|削除できた|削除した|補正)/i.test(safe)) return 'meal';
  return 'unknown';
}

function looksLikeExerciseRecordText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/[?？]/.test(safe)) return false;
  return /(ジョギング|ランニング|ウォーキング|散歩|筋トレ|スクワット|腕立て伏せ|腕立て|腹筋|背筋|プランク|体幹トレーニング|体幹トレ|コアトレ|走った|歩いた|運動).*(した|やった|分|回|km|ｋｍ|キロ)|(^|\s)\d+\s*(分|回)/.test(safe);
}

function looksLikeExplicitLabFollowupText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /(TG|中性脂肪|HbA1c|hba1c|LDH|AST|ALT|血糖|クレアチニン).*(は|？|\?)?$|何読み取れた|他の日付/.test(safe);
}

function looksLikeMealPortionCorrectionText(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /半分|1\/4|１\/４|ごはん半分|ご飯半分|少しだけ|ちょっとだけ|完食|食べてない|0kcal|ゼロ|麺だけ/.test(safe);
}

function looksLikeMealCalorieConfirmationTextRouter(text) {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (/今日の食事の総カロリー|今日の総カロリー|1日の総カロリー|今日の食事の合計|今日の合計|今日ここまで|積算/.test(safe)) return false;
  const hasKcalMention = /(カロリー|kcal|キロカロリー)/i.test(safe);
  const hasNumber = /(\d{2,4})\s*k?kcal?|(カロリー|kcal)\s*[：:はが]?\s*(\d{2,4})/i.test(safe);
  const hasQuestion = /かな\??|ですか\??|だろ|でしょう|合って|あって|正しい|どう思|どう\?|どう？|いくつ|くらい\?|くらい？|\?|？/.test(safe);
  if (hasKcalMention && hasNumber && hasQuestion) return true;
  if (hasNumber && hasQuestion && /(合って|あって|正しい)/.test(safe)) return true;
  return false;
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
  if (hasActiveImageSession && /^meal_/.test(normalizeText(active.type || active.domain || ''))) {
    if (looksLikeMealCalorieConfirmationTextRouter(safeText) || looksLikeMealPortionCorrectionText(safeText)) {
      console.info('[contextual_intent_guardrail_applied]', {
        userId: input?.userId || '',
        router: 'newflow_followup',
        action: 'release_to_legacy_orchestrator_meal_followup'
      });
      return null;
    }
  }
  if (hasActiveImageSession) {
    if (looksLikeExerciseRecordText(safeText) || looksLikeExplicitLabFollowupText(safeText)) return null;
    const isGeneral = looksLikeGeneralConversation(safeText);
    if (imageFollowupOnly && isGeneral) {
      if (looksLikeExerciseRecordText(safeText)) return null;
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
      const canonBundle = await canonicalFallbackService.getCanonicalLabPanel(input.userId, {
        logReachability: false,
        withSelectionTrace: true
      });
      const canonical = canonBundle.panel;
      const selectionTrace = canonBundle.selectionTrace;
      const brief = currentSessionId
        ? await labSessionRepository.getLabSessionValidationBrief(currentSessionId).catch(() => null)
        : null;
      const activeIsSuperseded = normalizeText(brief?.validation_status).toLowerCase() === 'superseded';
      if (canonical && activeIsSuperseded) {
        panel = mergeLabPanelsCanonicalItemsWin(panel, canonical);
        canonicalLabReached = true;
        answerSourceSessionId = canonical?.sourceSessionId || answerSourceSessionId;
      } else if (isWeakLabPanel(panel) && canonical) {
        panel = mergeLabPanels(panel, canonical);
        canonicalLabReached = true;
        answerSourceSessionId = canonical?.sourceSessionId || answerSourceSessionId;
      }
      logLabFollowupSessionValidationChoice({
        requested_text: safeText.slice(0, 400),
        current_session_id: currentSessionId,
        selected_session_id: selectionTrace?.selected_session_id ?? null,
        answer_source_session_id: answerSourceSessionId,
        selected_validation_status: selectionTrace?.selected_validation_status ?? null,
        selected_superseded_by_session_id: selectionTrace?.selected_superseded_by_session_id ?? null,
        skipped_superseded_session_ids: selectionTrace?.skipped_superseded_session_ids || [],
        selection_reason: selectionTrace?.selection_reason || '',
        active_context_superseded: activeIsSuperseded
      });
      return await resolveLabFollowup(safeText, panel, {
        userId: input.userId,
        lineUserId: input.lineUserId || input.userId,
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
      const canonBundle = await canonicalFallbackService.getCanonicalLabPanel(input?.userId, {
        logReachability: true,
        withSelectionTrace: true
      });
      const panel = canonBundle.panel;
      const selectionTrace = canonBundle.selectionTrace;
      if (panel) {
        logLabFollowupSessionValidationChoice({
          requested_text: safeText.slice(0, 400),
          current_session_id: null,
          selected_session_id: selectionTrace?.selected_session_id ?? null,
          answer_source_session_id: panel?.sourceSessionId || null,
          selected_validation_status: selectionTrace?.selected_validation_status ?? null,
          selected_superseded_by_session_id: selectionTrace?.selected_superseded_by_session_id ?? null,
          skipped_superseded_session_ids: selectionTrace?.skipped_superseded_session_ids || [],
          selection_reason: selectionTrace?.selection_reason || '',
          active_context_superseded: false
        });
        return await resolveLabFollowup(safeText, panel, {
          userId: input.userId,
          lineUserId: input.lineUserId || input.userId,
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
    const canonBundle = await canonicalFallbackService.getCanonicalLabPanel(input?.userId, {
      logReachability: true,
      withSelectionTrace: true
    });
    const panel = canonBundle.panel;
    const selectionTrace = canonBundle.selectionTrace;
    if (panel) {
      logLabFollowupSessionValidationChoice({
        requested_text: safeText.slice(0, 400),
        current_session_id: null,
        selected_session_id: selectionTrace?.selected_session_id ?? null,
        answer_source_session_id: panel?.sourceSessionId || null,
        selected_validation_status: selectionTrace?.selected_validation_status ?? null,
        selected_superseded_by_session_id: selectionTrace?.selected_superseded_by_session_id ?? null,
        skipped_superseded_session_ids: selectionTrace?.skipped_superseded_session_ids || [],
        selection_reason: selectionTrace?.selection_reason || '',
        active_context_superseded: false
      });
      return await resolveLabFollowup(safeText, panel, {
        userId: input.userId,
        lineUserId: input.lineUserId || input.userId,
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
  // active context が無い通常テキストは legacy 側へ流してよい（運動/通常会話を止めない）
  return null;
}

module.exports = {
  resolveFollowup,
};
