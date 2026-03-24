const {
  normalizeMealText,
  seemsMealTextCandidate,
  buildMealTextGuide,
} = require('../parsers/meal_parser');

function buildMealDraftFromText(text) {
  const normalized = normalizeMealText(text);

  return {
    source_type: 'text',
    original_text: normalized,
    meal_label: '食事',
    estimated_kcal: null,
    kcal_min: null,
    kcal_max: null,
    food_items: [],
    confidence: 0,
  };
}

function buildMealRecordedMessage(meal) {
  const lines = [
    '食事内容を受け取りました。',
    meal?.original_text ? `内容: ${meal.original_text}` : null,
    'このあとカロリー推定や集計につなげられる形で扱います。',
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  normalizeMealText,
  seemsMealTextCandidate,
  buildMealTextGuide,
  buildMealDraftFromText,
  buildMealRecordedMessage,
};