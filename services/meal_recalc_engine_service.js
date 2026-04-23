'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractBaseNutrition(basePayload = {}) {
  const estimated = basePayload.estimatedNutrition && typeof basePayload.estimatedNutrition === 'object'
    ? basePayload.estimatedNutrition
    : {};
  const adopted = basePayload.adoptedNutrition && typeof basePayload.adoptedNutrition === 'object'
    ? basePayload.adoptedNutrition
    : {};
  return {
    kcal: toNumber(basePayload.kcal ?? adopted.kcal ?? estimated.kcal, 0),
    protein: toNumber(basePayload.protein ?? adopted.protein ?? estimated.protein, 0),
    fat: toNumber(basePayload.fat ?? adopted.fat ?? estimated.fat, 0),
    carbs: toNumber(basePayload.carbs ?? adopted.carbs ?? estimated.carbs, 0),
  };
}

function extractBaseItems(basePayload = {}) {
  if (Array.isArray(basePayload.items)) {
    return basePayload.items
      .map((x) => normalizeText(x))
      .filter(Boolean);
  }
  if (Array.isArray(basePayload.food_items)) {
    return basePayload.food_items
      .map((x) => normalizeText(x))
      .filter(Boolean);
  }
  return [];
}

function detectEventClass(eventType) {
  const t = normalizeText(eventType).toLowerCase();
  if (/(remove|delete|not_eaten|zero|exclude)/.test(t)) return 'remove';
  if (/(portion|ratio|fraction|half)/.test(t)) return 'portion';
  if (/(manual|adjust|override|set_nutrition|delta)/.test(t)) return 'manual';
  return 'manual';
}

function stableSortEvents(events = []) {
  const order = { remove: 1, portion: 2, manual: 3 };
  return [...events]
    .map((event, idx) => ({ ...event, __idx: idx, __class: detectEventClass(event?.event_type) }))
    .sort((a, b) => {
      const ca = order[a.__class] || 99;
      const cb = order[b.__class] || 99;
      if (ca !== cb) return ca - cb;
      const pa = toNumber(a.priority, 0);
      const pb = toNumber(b.priority, 0);
      if (pa !== pb) return pa - pb;
      const ta = normalizeText(a.timestamp || '');
      const tb = normalizeText(b.timestamp || '');
      if (ta !== tb) return ta.localeCompare(tb);
      return toNumber(a.event_id, a.__idx) - toNumber(b.event_id, b.__idx);
    });
}

function applyRemoveEvent(state, event) {
  const payload = event?.payload_json && typeof event.payload_json === 'object' ? event.payload_json : {};
  const removeAll = Boolean(payload.removeAll || payload.remove_all || payload.mode === 'set_zero');
  if (removeAll) {
    state.removed_items.push(...state.items);
    state.items = [];
    state.kcal = 0;
    state.protein = 0;
    state.fat = 0;
    state.carbs = 0;
    return;
  }
  const target = normalizeText(payload.itemName || payload.item || payload.componentName || '');
  if (!target) return;
  const before = state.items.length;
  state.items = state.items.filter((x) => {
    const keep = normalizeText(x) !== target;
    if (!keep) state.removed_items.push(target);
    return keep;
  });
  if (before !== state.items.length) {
    // 項目単位の厳密栄養配分が未導入のため、現段階は変更率を payload ratio で補助適用
    const ratio = toNumber(payload.ratio, NaN);
    if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) {
      state.kcal *= ratio;
      state.protein *= ratio;
      state.fat *= ratio;
      state.carbs *= ratio;
    }
  }
}

function applyPortionEvent(state, event) {
  const payload = event?.payload_json && typeof event.payload_json === 'object' ? event.payload_json : {};
  const ratio = toNumber(payload.ratio, NaN);
  if (!Number.isFinite(ratio) || ratio < 0) return;
  state.kcal *= ratio;
  state.protein *= ratio;
  state.fat *= ratio;
  state.carbs *= ratio;
}

function applyManualEvent(state, event) {
  const payload = event?.payload_json && typeof event.payload_json === 'object' ? event.payload_json : {};
  const set = payload.setNutrition && typeof payload.setNutrition === 'object'
    ? payload.setNutrition
    : (payload.set_nutrition && typeof payload.set_nutrition === 'object' ? payload.set_nutrition : null);
  if (set) {
    state.kcal = toNumber(set.kcal, state.kcal);
    state.protein = toNumber(set.protein, state.protein);
    state.fat = toNumber(set.fat, state.fat);
    state.carbs = toNumber(set.carbs, state.carbs);
    return;
  }
  const delta = payload.deltaNutrition && typeof payload.deltaNutrition === 'object'
    ? payload.deltaNutrition
    : (payload.delta_nutrition && typeof payload.delta_nutrition === 'object' ? payload.delta_nutrition : null);
  if (!delta) return;
  state.kcal += toNumber(delta.kcal, 0);
  state.protein += toNumber(delta.protein, 0);
  state.fat += toNumber(delta.fat, 0);
  state.carbs += toNumber(delta.carbs, 0);
}

/**
 * 再計算エンジン（純関数）
 * @param {{meal: object, events: object[]}} input
 * @returns {{
 *   meal_id: number|null,
 *   kcal: number,
 *   protein: number,
 *   fat: number,
 *   carbs: number,
 *   item_list: string[],
 *   removed_items: string[],
 *   applied_event_ids: number[]
 * }}
 */
function recalcMealState(input = {}) {
  const meal = input?.meal && typeof input.meal === 'object' ? input.meal : {};
  const basePayload = meal?.base_payload_json && typeof meal.base_payload_json === 'object'
    ? meal.base_payload_json
    : {};
  const nutrition = extractBaseNutrition(basePayload);
  const events = stableSortEvents(Array.isArray(input?.events) ? input.events : []);

  const state = {
    meal_id: toNumber(meal?.id, null),
    kcal: nutrition.kcal,
    protein: nutrition.protein,
    fat: nutrition.fat,
    carbs: nutrition.carbs,
    items: extractBaseItems(basePayload),
    removed_items: [],
    applied_event_ids: [],
  };

  for (const event of events) {
    const cls = event.__class || detectEventClass(event?.event_type);
    if (cls === 'remove') applyRemoveEvent(state, event);
    else if (cls === 'portion') applyPortionEvent(state, event);
    else applyManualEvent(state, event);
    state.applied_event_ids.push(toNumber(event.event_id, 0));
  }

  return {
    meal_id: state.meal_id,
    kcal: round1(Math.max(0, state.kcal)),
    protein: round1(Math.max(0, state.protein)),
    fat: round1(Math.max(0, state.fat)),
    carbs: round1(Math.max(0, state.carbs)),
    item_list: [...new Set(state.items.map((x) => normalizeText(x)).filter(Boolean))],
    removed_items: [...new Set(state.removed_items.map((x) => normalizeText(x)).filter(Boolean))],
    applied_event_ids: state.applied_event_ids.filter((x) => Number.isFinite(x)),
  };
}

function recalcMealStateWithLog(input = {}, meta = {}) {
  const meal = input?.meal && typeof input.meal === 'object' ? input.meal : {};
  const basePayload = meal?.base_payload_json && typeof meal.base_payload_json === 'object'
    ? meal.base_payload_json
    : {};
  const before = {
    kcal: round1(extractBaseNutrition(basePayload).kcal),
    protein: round1(extractBaseNutrition(basePayload).protein),
    fat: round1(extractBaseNutrition(basePayload).fat),
    carbs: round1(extractBaseNutrition(basePayload).carbs),
    item_list: extractBaseItems(basePayload),
  };
  const after = recalcMealState(input);
  console.info('[meal-recalc] recompute_done', {
    userId: normalizeText(meta?.userId || ''),
    meal_id: after.meal_id,
    before,
    after: {
      kcal: after.kcal,
      protein: after.protein,
      fat: after.fat,
      carbs: after.carbs,
      item_list: after.item_list,
      removed_items: after.removed_items,
    },
    applied_event_ids: after.applied_event_ids,
  });
  return after;
}

module.exports = {
  recalcMealState,
  recalcMealStateWithLog,
  stableSortEvents,
};
