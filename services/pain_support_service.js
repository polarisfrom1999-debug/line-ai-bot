'use strict';

/**
 * pain_support_service.js
 *
 * 目的:
 * - 痛み相談を「全身痛」固定で返さない
 * - 痛み / しびれ / つる / 張り / 違和感 を分ける
 * - 軽症なら聞きすぎず、やさしく提案へ進む
 * - 危険サインがあれば受診寄りにする
 * - 将来の自動フォロー・管理者共有メモに使いやすい構造を返す
 *
 * 既存フローを壊しにくいように:
 * - 単独利用できる設計
 * - export を複数用意
 * - 返却値はできるだけ素直な JSON
 */

const BODY_PART_RULES = [
  { key: 'head', label: '頭', keywords: ['頭', '頭痛', 'こめかみ', '後頭部', '前頭部'] },
  { key: 'neck', label: '首', keywords: ['首', '頚', '頸', 'くび'] },
  { key: 'shoulder', label: '肩', keywords: ['肩', '肩口', '肩まわり'] },
  { key: 'arm', label: '腕', keywords: ['腕', '上腕', '前腕'] },
  { key: 'elbow', label: '肘', keywords: ['肘', 'ひじ'] },
  { key: 'wrist', label: '手首', keywords: ['手首', 'てくび'] },
  { key: 'hand', label: '手', keywords: ['手', '手のひら', '指', '親指', '小指', '中指', '薬指', '人差し指'] },
  { key: 'chest', label: '胸', keywords: ['胸', '胸部'] },
  { key: 'back', label: '背中', keywords: ['背中', '背部'] },
  { key: 'lower_back', label: '腰', keywords: ['腰', '腰痛', 'ぎっくり腰'] },
  { key: 'hip', label: '股関節', keywords: ['股関節', 'お尻', '臀部', '殿部', 'そけい部', '鼠径部'] },
  { key: 'thigh', label: '太もも', keywords: ['太もも', 'もも', '大腿'] },
  { key: 'knee', label: '膝', keywords: ['膝', 'ひざ'] },
  { key: 'shin', label: 'すね', keywords: ['すね', '脛'] },
  { key: 'calf', label: 'ふくらはぎ', keywords: ['ふくらはぎ', '腓腹', 'こむら'] },
  { key: 'ankle', label: '足首', keywords: ['足首', '足関節'] },
  { key: 'heel', label: 'かかと', keywords: ['かかと', '踵'] },
  { key: 'sole', label: '足底', keywords: ['足裏', '足の裏', '足底'] },
  { key: 'foot', label: '足', keywords: ['足', '足先', '足部'] },
  { key: 'whole_body', label: '全身', keywords: ['全身', '体中', 'からだ中', '全部', 'あちこち'] },
];

const SYMPTOM_RULES = [
  { key: 'pain', label: '痛み', keywords: ['痛い', '痛み', 'ズキズキ', 'ジンジン', 'ヒリヒリ', 'しくしく'] },
  { key: 'cramp', label: 'つる', keywords: ['つる', '攣る', 'こむら返り'] },
  { key: 'numbness', label: 'しびれ', keywords: ['しびれ', '痺れ', 'ビリビリ', 'ピリピリ'] },
  { key: 'tightness', label: '張り', keywords: ['張る', '張り', 'パンパン'] },
  { key: 'stiffness', label: 'こわばり', keywords: ['こわばる', 'こわばり', '硬い', '固い'] },
  { key: 'heaviness', label: '重だるさ', keywords: ['重い', 'だるい', '重だるい'] },
  { key: 'discomfort', label: '違和感', keywords: ['違和感', '変な感じ', 'なんか変'] },
  { key: 'swelling', label: '腫れ', keywords: ['腫れ', '腫れて', 'むくみ', '腫れてる'] },
];

const MECHANISM_RULES = [
  { key: 'trauma_hit', label: 'ぶつけた', keywords: ['ぶつけた', '打った', 'ぶつかった'] },
  { key: 'twist', label: 'ひねった', keywords: ['ひねった', '捻った'] },
  { key: 'fall', label: '転んだ', keywords: ['転んだ', '転倒', '倒れた'] },
  { key: 'overuse', label: '使いすぎ', keywords: ['使いすぎ', '歩きすぎ', '走りすぎ', 'やりすぎ', '負担', '酷使'] },
  { key: 'after_exercise', label: '運動後', keywords: ['運動後', '運動した後', '走った後', 'トレーニング後', '筋トレ後'] },
  { key: 'sudden', label: '急に', keywords: ['急に', '突然', 'いきなり'] },
  { key: 'gradual', label: '徐々に', keywords: ['だんだん', '徐々に', '少しずつ'] },
  { key: 'unknown', label: 'きっかけ不明', keywords: ['気づいたら', 'いつのまにか', '原因がわからない', 'わからない'] },
  { key: 'morning', label: '朝に強い', keywords: ['朝が痛い', '朝に痛い', '朝一が痛い', '起きた時に痛い'] },
  { key: 'walking', label: '歩行時', keywords: ['歩くと痛い', '歩行時', '歩いたら痛い'] },
  { key: 'resting', label: '安静時', keywords: ['じっとしてても痛い', '安静にしていても痛い', '何もしてなくても痛い'] },
  { key: 'night', label: '夜間', keywords: ['夜に痛い', '夜間痛', '夜中に痛い'] },
];

const RED_FLAG_RULES = [
  { key: 'cannot_walk', label: '歩行困難', keywords: ['歩けない', '歩くのが無理', '体重をかけられない'] },
  { key: 'severe_swelling', label: '強い腫れ', keywords: ['かなり腫れてる', 'すごく腫れてる', '強く腫れてる'] },
  { key: 'bruise', label: '内出血', keywords: ['内出血', '青あざ', '紫になってる'] },
  { key: 'rest_pain', label: '安静時痛', keywords: ['じっとしてても痛い', '安静でも痛い'] },
  { key: 'night_pain', label: '夜間痛', keywords: ['夜間痛', '夜中に痛い', '寝てても痛い'] },
  { key: 'persistent_numbness', label: 'しびれ持続', keywords: ['しびれが続く', 'ずっとしびれる', 'しびれっぱなし'] },
  { key: 'weakness', label: '力が入りにくい', keywords: ['力が入らない', '力が入りにくい', '抜ける感じ'] },
  { key: 'fever', label: '発熱あり', keywords: ['熱がある', '発熱', '熱っぽい'] },
];

function normalizeText(input) {
  return String(input || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[！!]/g, '！')
    .replace(/[？?]/g, '？');
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function matchRules(text, rules) {
  const hits = [];
  for (const rule of rules) {
    if ((rule.keywords || []).some((kw) => text.includes(kw))) {
      hits.push(rule);
    }
  }
  return hits;
}

function pickPrimaryBodyPart(parts) {
  if (!parts || !parts.length) return null;

  const priority = [
    'heel',
    'sole',
    'ankle',
    'calf',
    'knee',
    'thigh',
    'hip',
    'lower_back',
    'back',
    'shoulder',
    'neck',
    'elbow',
    'wrist',
    'hand',
    'foot',
    'whole_body',
  ];

  for (const key of priority) {
    const found = parts.find((p) => p.key === key);
    if (found) return found;
  }
  return parts[0] || null;
}

function pickPrimarySymptom(symptoms) {
  if (!symptoms || !symptoms.length) return null;

  const priority = [
    'numbness',
    'cramp',
    'swelling',
    'pain',
    'tightness',
    'stiffness',
    'heaviness',
    'discomfort',
  ];

  for (const key of priority) {
    const found = symptoms.find((s) => s.key === key);
    if (found) return found;
  }
  return symptoms[0] || null;
}

function inferConditionHints(text, primaryPart, primarySymptom) {
  const hints = [];

  if (text.includes('足底腱膜炎')) {
    hints.push({
      key: 'plantar_fascia',
      label: '足底腱膜炎の可能性に配慮',
      body_part: '足底 / かかと',
    });
  }

  if (primaryPart?.key === 'heel' || primaryPart?.key === 'sole') {
    if (text.includes('朝') || text.includes('起きた時') || text.includes('朝一')) {
      hints.push({
        key: 'heel_sole_morning_load',
        label: '朝の一歩目で出やすい足底・踵まわりの負担に配慮',
        body_part: '足底 / かかと',
      });
    }
  }

  if (primaryPart?.key === 'calf' && primarySymptom?.key === 'cramp') {
    hints.push({
      key: 'calf_cramp',
      label: 'ふくらはぎのつりに配慮',
      body_part: 'ふくらはぎ',
    });
  }

  if (primaryPart?.key === 'lower_back' && primarySymptom?.key === 'numbness') {
    hints.push({
      key: 'lumbar_neuro',
      label: '腰由来のしびれの可能性に配慮',
      body_part: '腰',
    });
  }

  return hints;
}

function calcSeverity({ symptoms, redFlags, mechanisms, text }) {
  const symptomKeys = symptoms.map((s) => s.key);
  const mechanismKeys = mechanisms.map((m) => m.key);
  const redFlagKeys = redFlags.map((r) => r.key);

  if (
    redFlagKeys.includes('cannot_walk') ||
    redFlagKeys.includes('weakness') ||
    redFlagKeys.includes('persistent_numbness') ||
    redFlagKeys.includes('night_pain') ||
    redFlagKeys.includes('fever')
  ) {
    return 'urgent';
  }

  if (
    redFlagKeys.includes('bruise') ||
    redFlagKeys.includes('severe_swelling') ||
    redFlagKeys.includes('rest_pain') ||
    mechanismKeys.includes('fall') ||
    mechanismKeys.includes('twist')
  ) {
    return 'moderate';
  }

  if (
    symptomKeys.includes('numbness') ||
    symptomKeys.includes('swelling')
  ) {
    return 'moderate';
  }

  if (
    text.includes('かなり痛い') ||
    text.includes('すごく痛い') ||
    text.includes('激痛')
  ) {
    return 'moderate';
  }

  return 'mild';
}

function buildFollowupQuestions({ severity, primaryPart, primarySymptom, redFlags, mechanisms }) {
  const questions = [];

  if (severity === 'mild') {
    return questions;
  }

  const redFlagKeys = redFlags.map((r) => r.key);
  const mechanismKeys = mechanisms.map((m) => m.key);

  if (mechanismKeys.includes('fall') || mechanismKeys.includes('twist') || mechanismKeys.includes('trauma_hit')) {
    questions.push('ぶつけた・ひねった・転んだ、のどれに近いですか？');
    questions.push('腫れや内出血はありますか？');
  }

  if (primarySymptom?.key === 'numbness') {
    questions.push('しびれはずっと続いていますか？それとも一時的ですか？');
    questions.push('力が入りにくい感じはありますか？');
  }

  if (primaryPart?.key === 'heel' || primaryPart?.key === 'sole') {
    questions.push('朝の一歩目で強いですか？歩いているうちに少し変わりますか？');
  }

  if (primaryPart?.key === 'knee') {
    questions.push('曲げ伸ばしで痛いですか？歩く時に痛いですか？');
  }

  if (redFlagKeys.includes('night_pain') || redFlagKeys.includes('rest_pain')) {
    questions.push('何もしていない時や夜中にも痛みますか？');
  }

  return uniq(questions).slice(0, 3);
}

function buildSelfCareAdvice({ severity, primaryPart, primarySymptom, mechanisms }) {
  const advice = [];

  if (severity === 'urgent') {
    advice.push('無理に動かさず、今日は負担を減らしてください。');
    advice.push('しびれ・力の入りにくさ・歩けないほどの痛みがある場合は、早めに医療機関へ相談してください。');
    return advice;
  }

  if (severity === 'moderate') {
    advice.push('今日は無理に頑張らず、まずは負担を減らしてください。');
    advice.push('腫れや熱っぽさがある時は冷やす方向、こわばり中心なら温めて楽になるかをみてください。');
    advice.push('悪化する・長引く・強くなる場合は早めに相談してください。');
    return advice;
  }

  // mild
  if (primaryPart?.key === 'heel' || primaryPart?.key === 'sole') {
    advice.push('足裏やかかとに負担がかかりやすいので、今日は長時間歩行や強い運動は少し控えめで大丈夫です。');
    advice.push('朝や歩き始めがつらい時は、急に動かず軽く足首を動かしてから立つと楽なことがあります。');
  } else if (primaryPart?.key === 'calf' && primarySymptom?.key === 'cramp') {
    advice.push('ふくらはぎがつった時は、急に頑張らず、ゆっくり伸ばして落ち着かせてください。');
    advice.push('水分や冷え、疲労が関係することもあるので、今日は少し回復寄りでいきましょう。');
  } else if (primaryPart?.key === 'lower_back') {
    advice.push('腰まわりは無理に反らしたり勢いよく動かさず、今日は楽な姿勢を優先で大丈夫です。');
  } else {
    advice.push('今日はその部位に無理をかけすぎず、まずは少し負担を落として様子をみてください。');
  }

  if (mechanisms.some((m) => m.key === 'overuse' || m.key === 'after_exercise')) {
    advice.push('使いすぎ寄りなら、一度しっかり回復側に寄せるだけでも変わることがあります。');
  }

  advice.push('数日たっても変わらない、悪化する、しびれが出る場合は早めに相談してください。');
  return uniq(advice).slice(0, 3);
}

function buildReply({ primaryPart, primarySymptom, severity, followupQuestions, selfCareAdvice, conditionHints }) {
  const partLabel = primaryPart?.label || 'その部分';
  const symptomLabel = primarySymptom?.label || '不調';

  const introMild = [
    `${partLabel}の${symptomLabel}、気になりますね。`,
    `${partLabel}まわりがつらいのですね。`,
    `${partLabel}の様子、少し気にかけたい感じですね。`,
  ];

  const introModerate = [
    `${partLabel}の${symptomLabel}、少し丁寧にみたいです。`,
    `${partLabel}の症状、無理はしない方がよさそうです。`,
  ];

  const introUrgent = [
    `${partLabel}の症状は少し慎重にみた方がよさそうです。`,
    `${partLabel}の状態、今日は無理をかけない方が安全です。`,
  ];

  const hintLine = conditionHints?.length
    ? `内容からは、${conditionHints[0].label}です。`
    : '';

  let lines = [];

  if (severity === 'urgent') {
    lines.push(introUrgent[0]);
    if (hintLine) lines.push(hintLine);
    lines = lines.concat(selfCareAdvice);
    if (followupQuestions.length) {
      lines.push(`確認できるなら、${followupQuestions[0]}`);
    }
    return lines.join('\n');
  }

  if (severity === 'moderate') {
    lines.push(introModerate[0]);
    if (hintLine) lines.push(hintLine);
    lines = lines.concat(selfCareAdvice);
    if (followupQuestions.length) {
      lines.push(`差し支えなければ、${followupQuestions.join(' / ')}`);
    }
    return lines.join('\n');
  }

  // mild
  lines.push(introMild[0]);
  if (hintLine) lines.push(hintLine);
  lines = lines.concat(selfCareAdvice);
  return lines.join('\n');
}

function buildAdminMemo(result) {
  const {
    original_text,
    primary_part,
    primary_symptom,
    severity,
    mechanisms,
    red_flags,
    condition_hints,
  } = result || {};

  return {
    memo_type: 'pain_support',
    severity,
    summary: `${primary_part?.label || '部位不明'} / ${primary_symptom?.label || '症状不明'}`,
    chief_complaint: original_text || '',
    body_part: primary_part?.label || null,
    symptom: primary_symptom?.label || null,
    mechanisms: (mechanisms || []).map((m) => m.label),
    red_flags: (red_flags || []).map((r) => r.label),
    hints: (condition_hints || []).map((h) => h.label),
    recommended_followup_timing:
      severity === 'urgent' ? '早め確認'
      : severity === 'moderate' ? '1〜2日以内'
      : '2〜3日後',
  };
}

function analyzePainText(text) {
  const normalized = normalizeText(text);

  const bodyParts = matchRules(normalized, BODY_PART_RULES);
  const symptoms = matchRules(normalized, SYMPTOM_RULES);
  const mechanisms = matchRules(normalized, MECHANISM_RULES);
  const redFlags = matchRules(normalized, RED_FLAG_RULES);

  const primaryPart = pickPrimaryBodyPart(bodyParts);
  const primarySymptom = pickPrimarySymptom(symptoms);
  const conditionHints = inferConditionHints(normalized, primaryPart, primarySymptom);
  const severity = calcSeverity({
    symptoms,
    redFlags,
    mechanisms,
    text: normalized,
  });

  const followupQuestions = buildFollowupQuestions({
    severity,
    primaryPart,
    primarySymptom,
    redFlags,
    mechanisms,
  });

  const selfCareAdvice = buildSelfCareAdvice({
    severity,
    primaryPart,
    primarySymptom,
    mechanisms,
  });

  const replyText = buildReply({
    primaryPart,
    primarySymptom,
    severity,
    followupQuestions,
    selfCareAdvice,
    conditionHints,
  });

  const result = {
    detected: Boolean(primaryPart || primarySymptom || redFlags.length || mechanisms.length),
    original_text: normalized,
    severity, // mild / moderate / urgent
    body_parts: bodyParts.map((b) => ({
      key: b.key,
      label: b.label,
    })),
    primary_part: primaryPart
      ? { key: primaryPart.key, label: primaryPart.label }
      : null,
    symptoms: symptoms.map((s) => ({
      key: s.key,
      label: s.label,
    })),
    primary_symptom: primarySymptom
      ? { key: primarySymptom.key, label: primarySymptom.label }
      : null,
    mechanisms: mechanisms.map((m) => ({
      key: m.key,
      label: m.label,
    })),
    red_flags: redFlags.map((r) => ({
      key: r.key,
      label: r.label,
    })),
    condition_hints,
    followup_questions: followupQuestions,
    self_care_advice: selfCareAdvice,
    reply_text: replyText,
  };

  result.admin_memo = buildAdminMemo(result);
  return result;
}

function looksLikePainConsultation(text) {
  const normalized = normalizeText(text);
  const bodyPartHits = matchRules(normalized, BODY_PART_RULES);
  const symptomHits = matchRules(normalized, SYMPTOM_RULES);

  const consultationWords = [
    'どうしたら',
    '大丈夫',
    '走っていい',
    '歩いていい',
    '受診',
    '病院',
    '相談',
    'かな',
    'です',
  ];

  const hasConsultationTone = consultationWords.some((w) => normalized.includes(w));

  return bodyPartHits.length > 0 && symptomHits.length > 0 && hasConsultationTone;
}

function generatePainResponse(text) {
  const analyzed = analyzePainText(text);
  return analyzed.reply_text || '';
}

module.exports = {
  analyzePainText,
  generatePainResponse,
  looksLikePainConsultation,
};
