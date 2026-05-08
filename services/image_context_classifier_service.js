'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * 画像が食事写真だけでないケースを粗く分類する（スクショ・表・共有など）。
 * @param {{ userCaption?: string, assistantPreview?: string }} params
 * @returns {{ image_context_type: string, reason: string }}
 */
function classifyImageContext(params = {}) {
  const cap = normalizeText(params.userCaption || '');
  const prev = normalizeText(params.assistantPreview || '');
  const blob = `${cap} ${prev}`;

  let image_context_type = 'unknown';
  let reason = 'no_strong_signal';

  if (/(表|一覧|チェック|記録表|管理表|スプレッド|Excel|栄養素|摂取目安|項目)/.test(blob)) {
    image_context_type = 'nutrition_table';
    reason = 'table_keywords';
  } else if (/(進捗|レポート|PDCA|グラフ|推移|成果)/.test(blob)) {
    image_context_type = 'progress_report';
    reason = 'progress_keywords';
  } else if (/(LINE|トーク|スクショ|返信|会話|●|〇〇さん)/.test(blob)) {
    image_context_type = 'screenshot_conversation';
    reason = 'conversation_shot_keywords';
  } else if (/(共有|見て|確認して|これで合って)/.test(blob)) {
    image_context_type = 'user_shared_record';
    reason = 'share_intent_keywords';
  } else if (/(ご飯|食事|ランチ|朝食|夕食|おやつ|カロリー|献立)/.test(blob) || cap.length < 24) {
    image_context_type = 'meal_photo';
    reason = 'meal_or_short_caption_default';
  }

  console.info('[image_context_type]', { image_context_type, reason: `${reason}:${blob.slice(0, 80)}` });
  return { image_context_type, reason };
}

module.exports = {
  classifyImageContext
};
