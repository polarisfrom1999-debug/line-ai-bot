'use strict';

function shouldCompressGuidance({ conversationState, guidanceType }) {
  if (!conversationState?.lastGuidanceType) return false;
  return conversationState.lastGuidanceType === guidanceType;
}

function compressGuidanceText(guidanceType, originalText) {
  const map = {
    general_usage_help: 'まとまっていなくても、そのまま短く送って大丈夫です。',
    weight_input_help: '体重は数字だけでも大丈夫です。',
    meal_input_help: '食事は写真だけでも一言だけでも大丈夫です。',
    summary_view_help: '振り返りは「今週の振り返り」や「グラフ出して」で大丈夫です。',
    persona_change_help: 'タイプ変更はそのまま希望を送ってもらえれば大丈夫です。',
    symptom_entry_help: '気になる場所と、いつからかだけでも大丈夫です。',
    homecare_entry_help: 'つらい場所と困る動きだけでも大丈夫です。',
    sports_entry_help: '競技名と困りごとを一言でも大丈夫です。',
    competition_entry_help: '種目と時間だけでも大丈夫です。',
  };
  return map[guidanceType] || originalText;
}

module.exports = {
  shouldCompressGuidance,
  compressGuidanceText,
};
