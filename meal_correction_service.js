'use strict';

/**
 * lab_intake_service.js
 *
 * 目的:
 * - 初回案内やタイプ表示を 4タイプ表記へ統一するための補助
 * - 既存 intake サービスへ後でマージしやすい軽量版
 */

const PERSONA_LABELS = [
  'そっと寄り添う',
  '明るく後押し',
  '頼もしく導く',
  '力強く支える',
];

function buildPersonaIntroText() {
  return [
    'ここから。では、寄り添い方の雰囲気を次の4つから選べます。',
    ...PERSONA_LABELS.map((label) => `・${label}`),
    '途中で変えることもできますので、今の気分で大丈夫です。',
  ].join('\n');
}

module.exports = {
  PERSONA_LABELS,
  buildPersonaIntroText,
};
