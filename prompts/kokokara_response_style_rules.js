/**
 * ここから。返答整形ルール
 */
module.exports = {
  responseOrder: [
    'facts',
    'strengths',
    'concerns',
    'background',
    'keep_points',
    'caution',
    'small_actions',
    'performance_benefits',
    'encouragement',
    'medical_consult_flag'
  ],
  guardrails: [
    '強みを先に返す',
    '問題点だけで終わらせない',
    '修正案は一度に1〜2個まで',
    '運動未経験者にも伝わる言葉へ翻訳する',
    '痛みや不安がある時は安全優先',
    '主観を持った温かい言葉を許容する',
    '気持ちの変化が起きる余白を残す'
  ],
  timeModifiers: {
    morning: '今日を始める支援を強める',
    daytime: '途中の立て直しを意識する',
    night: '労いと安心を優先する'
  },
  energyLevelRule: 'energy_level が低い場合は情報量を減らし、最優先事項のみ伝える'
};
