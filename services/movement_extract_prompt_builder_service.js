'use strict';

function buildMovementExtractPrompt({ rawText = '', angleHint = '', sessionClipCount = 0, mode = 'still' } = {}) {
  const schema = {
    type: 'object',
    properties: {
      is_movement_media: { type: 'boolean' },
      angle: { type: 'string' },
      focus_points: { type: 'array', items: { type: 'string' } },
      event_hypotheses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            side: { type: 'string' },
            confidence: { type: 'number' }
          },
          required: ['type']
        }
      },
      asymmetry_notes: { type: 'array', items: { type: 'string' } },
      posture_notes: { type: 'array', items: { type: 'string' } },
      next_best_angle: { type: 'string' },
      issues: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' }
    },
    required: ['is_movement_media', 'focus_points', 'confidence']
  };

  const prompt = [
    `あなたは「ここから。」のスポーツ動作 ${mode === 'video' ? '動画' : '静止画'} 抽出担当です。返答はJSONのみです。`,
    '目的は、フォーム改善や違和感相談のために、角度・左右差・着地や体幹などの観点を構造化することです。',
    '断定診断は禁止です。候補や見どころとして整理してください。',
    'event_hypotheses では initial_contact / mid_stance / toe_off / flight_phase などの候補を使ってください。',
    'focus_points には着地位置、接地時間候補、体幹ぶれ、骨盤、膝の向き、腕振りなどを入れてください。',
    `利用者の補助テキスト: ${String(rawText || '').trim() || 'なし'}`,
    `角度ヒント: ${angleHint || 'なし'}`,
    `同じ回の素材数: ${Number(sessionClipCount || 0)}`
  ].join('\n');

  return {
    domain: mode === 'video' ? 'movement_video' : 'movement_image',
    promptVersion: 'movement_extract_v1',
    schema,
    prompt,
    temperature: 0.12,
    preferredModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  };
}

module.exports = {
  buildMovementExtractPrompt
};
