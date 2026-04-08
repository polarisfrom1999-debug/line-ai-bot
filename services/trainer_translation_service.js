'use strict';

/**
 * trainer_translation_service.js
 *
 * Gemini の観察結果を、そのまま見せるのではなく
 * 「ここから。のトレーナーとしての言葉」に翻訳する。
 */

function pushIf(list, condition, value) {
  if (condition) list.push(value);
}

function translateMovementToCoachMessage(normalized, opts = {}) {
  const findings = normalized?.findings || {};
  const lines = [];

  const intro = opts.userName
    ? `${opts.userName}さんの今回の動きを見ると、`
    : '今回の動きを見ると、';

  const focus = [];
  pushIf(focus, findings.foot_strike === 'forefoot', 'つま先寄りの接地が強めです');
  pushIf(focus, findings.foot_strike === 'midfoot', '接地はミッドフット寄りです');
  pushIf(focus, findings.heel_contact === 'minimal', '踵が地面につく時間は短めです');
  pushIf(focus, findings.knee_tracking === 'inward', '膝が少し内側に入りやすいです');
  pushIf(focus, findings.trunk_stability === 'mild_sway', '体幹のぶれは少しあります');
  pushIf(focus, findings.asymmetry === 'mild' || findings.asymmetry === 'moderate', '左右差も少し見えます');

  lines.push(intro + (focus.length ? `${focus.join('、')}。` : 'まずは大きく崩れてはいません。'));

  if (findings.achilles_load_risk === 'high' || findings.achilles_load_risk === 'medium') {
    lines.push('アキレス腱まわりに負担が集まりやすい流れなので、まずは着地で足裏全体を少し使える形へ寄せたいです。');
  }

  if (Array.isArray(normalized?.coach_cues) && normalized.coach_cues.length > 0) {
    lines.push(`意識は一度に増やさず、まずは「${normalized.coach_cues[0]}」からで十分です。`);
  }

  if (Array.isArray(normalized?.drills) && normalized.drills.length > 0) {
    lines.push(`今日やるなら、${normalized.drills.slice(0, 3).join('、')}あたりが入りやすいです。`);
  }

  if (Array.isArray(normalized?.needs_more_views) && normalized.needs_more_views.length > 0) {
    lines.push(`次に細かく見るなら、${normalized.needs_more_views.join('、')}があると精度が上がります。`);
  }

  return lines.join('\n');
}

module.exports = {
  translateMovementToCoachMessage,
};
