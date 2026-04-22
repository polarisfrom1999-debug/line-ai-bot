'use strict';

let supabase = null;
try {
  ({ supabase } = require('../services/supabase_service'));
} catch (_error) {
  supabase = null;
}

const { ensureUser } = require('../services/user_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function getLatestCanonicalMeal(lineUserId) {
  const safeUserId = normalizeText(lineUserId);
  if (!supabase || !safeUserId) return null;
  try {
    const user = await ensureUser(supabase, safeUserId, 'Asia/Tokyo');
    if (!user?.id) return null;
    const { data, error } = await supabase
      .from('meal_logs')
      .select('id,eaten_at,meal_label,food_items,estimated_kcal,protein_g,fat_g,carbs_g,raw_model_json,deleted_at')
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('eaten_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const raw = data.raw_model_json && typeof data.raw_model_json === 'object' ? data.raw_model_json : {};
    return {
      id: data.id || null,
      eatenAt: data.eaten_at || '',
      mealLabel: normalizeText(data.meal_label || '食事'),
      foodItems: Array.isArray(data.food_items) ? data.food_items.map((x) => normalizeText(x)).filter(Boolean) : [],
      adoptedNutrition: {
        kcal: Number(data.estimated_kcal || 0),
        protein: Number(data.protein_g || 0),
        fat: Number(data.fat_g || 0),
        carbs: Number(data.carbs_g || 0),
      },
      correction: raw?.correction && typeof raw.correction === 'object' ? raw.correction : null,
      rawModelJson: raw,
    };
  } catch (_error) {
    return null;
  }
}

module.exports = {
  getLatestCanonicalMeal,
};
