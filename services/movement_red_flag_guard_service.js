'use strict';

/**
 * 赤旗ガード — セルフケア・筋トレ提案をブロックし医療確認を優先。
 */

const RED_FLAG_PATTERNS = [
  { key: 'fall_severe_pain', label: '転倒後の強い痛み', re: /転ん|転倒|転げ|落ちた|転落/ },
  { key: 'fracture_suspect', label: '骨折疑い', re: /骨折|骨が折|折れた/ },
  { key: 'dislocation_suspect', label: '脱臼疑い', re: /脱臼|抜けた|戻らない関節/ },
  { key: 'severe_swelling_deformity', label: '強い腫れ・変形', re: /(すごく|かなり|強く)腫れ|変形|ぐにゃ|曲がりっぱなし/ },
  { key: 'heat_swelling', label: '熱感・強い腫れ', re: /熱を持|熱感|腫れて.*熱/ },
  { key: 'rest_severe_pain', label: '安静時激痛', re: /じっとしてても|安静でも|何もしてなくても.*(激しい|強い)痛/ },
  { key: 'sudden_paralysis', label: '急な麻痺', re: /急に.*(動か|麻痺)|動かなくな/ },
  { key: 'unilateral_paralysis', label: '片側麻痺', re: /片側.*麻痺|片麻痺|半身.*麻痺|麻痺.*片側/ },
  { key: 'slurred_speech', label: 'ろれつ障害', re: /ろれつ|話がうまく|言葉が出/ },
  { key: 'facial_droop', label: '顔のゆがみ', re: /顔がゆが|顔の片側|口角が下が/ },
  { key: 'chest_pain', label: '胸痛', re: /胸が痛|胸痛|胸が苦|胸の圧迫/ },
  { key: 'breathlessness', label: '息苦しさ', re: /息が苦|息苦し|呼吸が苦|呼吸困難/ },
  { key: 'cauda_equina', label: '排尿排便障害を伴う腰痛', re: /(腰痛|腰).*(排尿|排便|尿|便).*(出ない|困難|できない|異常|変)|(排尿|排便).*(腰痛|腰|しびれ)|(排尿|排便).*(変|おかしい)/ },
  { key: 'rapid_neuro_deficit', label: 'しびれ・筋力低下の急激な悪化', re: /(しびれ|力が入ら).*(急に|突然|強く)|急に.*(しびれ|力が入ら)/ },
  { key: 'fever_severe_pain', label: '発熱を伴う強い痛み', re: /(熱|発熱).*(痛|痛い)|(痛|痛い).*(熱|発熱)/ },
  { key: 'osteoporosis_fall', label: '骨粗鬆症＋転倒後痛', re: /骨粗|骨粗鬆|転倒.*(腰|股|手首)|軽い転倒.*痛/ },
  { key: 'child_severe', label: '子どもの強い痛み・歩けない', re: /(子ども|子供|息子|娘).*(歩けない|腫れ|強い痛)|歩けない.*(子ども|子供)/ },
  { key: 'cannot_walk', label: '歩行困難', re: /歩けない|歩けません|体重をかけられない/ },
  { key: 'shin_point_pain_jump', label: 'すね一点痛＋片脚ジャンプ痛', re: /(すね|脛).*(一点|ズキ|鋭い).*(痛|ジャンプ)|片脚.*ジャンプ.*痛/ },
  { key: 'shin_walk_pain', label: '歩行でもすね痛', re: /(すね|脛).*(歩いても|歩くと).*痛/ },
  { key: 'shin_rest_pain', label: '休んでもすね痛', re: /(すね|脛).*(休んでも|休めても).*痛/ },
];

const MEDICAL_CHECK_PATTERNS = [
  { key: 'night_pain', label: '夜間痛', re: /夜.*痛|夜間痛|寝てても痛/ },
  { key: 'persistent_numbness', label: '持続しびれ', re: /しびれが続|ずっとしびれ|しびれっぱなし/ },
  { key: 'weakness', label: '力が入りにくい', re: /力が入らない|力が入りにく|脱力/ },
  { key: 'worsening_trend', label: '悪化傾向', re: /どんどん|ますます|悪化|ひどくな/ },
  { key: 'injury_recent', label: '外傷後', re: /捻挫|打撲|怪我|ケガ|ぶつけ/ },
  { key: 'shin_spread_pain', label: 'すね内側広範囲痛', re: /すね.*内側|脛.*内側|シンスプリント|shin splints|MTSS|脛骨過労/ },
];

function normalizeText(v) {
  return String(v || '').trim();
}

function evaluateRedFlags(text = '') {
  const t = normalizeText(text);
  const flags = [];
  for (const p of RED_FLAG_PATTERNS) {
    if (p.re.test(t)) flags.push({ key: p.key, label: p.label, severity: 'red_flag' });
  }
  const isRedFlag = flags.length > 0;
  return {
    isRedFlag,
    flags,
    blockSelfCare: isRedFlag,
    blockExerciseProposal: isRedFlag,
    priorityMessage: isRedFlag
      ? 'いまの状態は、まず医療機関への相談を優先した方が安全です。強い痛みやしびれ、力の入りにくさがある場合は早めに確認してください。'
      : null,
  };
}

function evaluateMedicalCheckSignals(text = '') {
  const t = normalizeText(text);
  const signals = [];
  for (const p of MEDICAL_CHECK_PATTERNS) {
    if (p.re.test(t)) signals.push({ key: p.key, label: p.label });
  }
  return signals;
}

function isShinSplintRedFlag(text = '') {
  const t = normalizeText(text);
  return /(すね|脛).*(一点|ズキ|鋭い)/.test(t)
    || /片脚.*ジャンプ.*痛|ジャンプ.*(ズキ|激)/.test(t)
    || /(歩いても|休んでも).*(すね|脛).*痛/.test(t)
    || /(腫れ|熱感).*(すね|脛)/.test(t);
}

module.exports = {
  evaluateRedFlags,
  evaluateMedicalCheckSignals,
  isShinSplintRedFlag,
  RED_FLAG_PATTERNS,
};
