'use strict';

/**
 * lab_image_session / lab_followup 中の発話を、雑談へ逃がさず lab 系として継続扱いする。
 * keyword パッチではなく active context + 発話意図の組み合わせで判定する。
 */

function normalizeText(v) {
  return String(v || '').trim();
}

const LAB_ACTIVE_CONTEXT_TYPES = new Set([
  'lab_image_session',
  'lab_followup',
  'lab_followup_session',
  'lab_image_session_failed',
]);

function isLabActiveContext(activeContextType = '') {
  const t = normalizeText(activeContextType);
  if (!t) return false;
  if (LAB_ACTIVE_CONTEXT_TYPES.has(t)) return true;
  if (/^lab_image_session/.test(t) || /^lab_followup/.test(t)) return true;
  return false;
}

function resolveActiveContextType(shortMemory = {}) {
  return normalizeText(
    shortMemory?.activeContext?.type
    || shortMemory?.activeContext?.domain
    || shortMemory?.followUpContext?.imageType
    || shortMemory?.followUpContext?.source
    || ''
  );
}

function isLabDateInventoryUtterance(text = '') {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /他の検査日|他の日付|他の日は|別の日付|保存されている検査日|日付一覧|何日の検査|何日分|検査日(は|の)?[？?]?$|検査日.*(一覧|ある|いくつ|何|教えて)|保存.*(検査日|日付)|前回は[？?]?$|いつの検査/i.test(
    safe
  );
}

function isLabComparisonUtterance(text = '') {
  const safe = normalizeText(text);
  if (!safe) return false;
  return /前回(と|と)?(比(べ|較)|比較)|前と比べ|比較して|比較(して|する|したい|は)/.test(safe);
}

function isLabTrendUtterance(text = '') {
  const safe = normalizeText(text);
  if (!safe) return false;
  if (isLabComparisonUtterance(safe)) return false;
  return /傾向(は|どう)?[？?]?$|推移(は|どう)?[？?]?$|この検査の傾向/.test(safe);
}

function isExplicitLabItemUtterance(text = '') {
  const safe = normalizeText(text);
  return /(TG|中性脂肪|HbA1c|hba1c|LDH|AST|ALT|血糖|クレアチニン).*(は|？|\?)?$|何読み取れ/.test(safe);
}

/**
 * @returns {null | { primary_mode: string, surface_intent: string, route: 'lab_followup', reason: string, query_hint?: string }}
 */
function resolveLabContextContinuation({ text = '', activeContextType = '', shortMemory = {} } = {}) {
  const safe = normalizeText(text);
  const active = normalizeText(activeContextType) || resolveActiveContextType(shortMemory);
  if (!safe || !isLabActiveContext(active)) return null;

  if (isLabDateInventoryUtterance(safe)) {
    return {
      primary_mode: 'lab_date_inventory',
      surface_intent: 'lab_date_inventory',
      route: 'lab_followup',
      reason: 'lab_context_continuation_date_inventory',
      query_hint: 'lab_date_inventory',
    };
  }

  if (isLabComparisonUtterance(safe)) {
    return {
      primary_mode: 'lab_comparison',
      surface_intent: 'lab_comparison',
      route: 'lab_followup',
      reason: 'lab_context_continuation_comparison',
      query_hint: 'comparison',
    };
  }

  if (isLabTrendUtterance(safe)) {
    return {
      primary_mode: 'lab_followup',
      surface_intent: 'lab_followup',
      route: 'lab_followup',
      reason: 'lab_context_continuation_trend',
      query_hint: 'trend',
    };
  }

  if (isExplicitLabItemUtterance(safe)) {
    return {
      primary_mode: 'lab_followup',
      surface_intent: 'lab_followup',
      route: 'lab_followup',
      reason: 'lab_context_continuation_item_query',
      query_hint: 'single_item',
    };
  }

  return null;
}

module.exports = {
  isLabActiveContext,
  resolveActiveContextType,
  isLabDateInventoryUtterance,
  isLabComparisonUtterance,
  isLabTrendUtterance,
  resolveLabContextContinuation,
};
