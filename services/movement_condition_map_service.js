'use strict';

/**
 * 症状・疾患名 → 部位・リスク・会話モード（診断断定には使わない参照マップ）
 */

const BODY_REGION = {
  LUMBAR_PELVIS: 'lumbar_pelvis',
  SPINE_POSTURE: 'spine_posture',
  NECK_HEAD: 'neck_head',
  SHOULDER: 'shoulder',
  HIP_KNEE: 'hip_knee',
  LOWER_LEG: 'lower_leg',
  HAND_ELBOW: 'hand_elbow',
  TRAUMA: 'trauma',
  SYSTEMIC: 'systemic',
};

const RISK = {
  RED_FLAG: 'red_flag',
  NEEDS_MEDICAL: 'needs_medical_check',
  NEEDS_CAUTION: 'needs_caution',
  SAFE_SELF_CARE: 'safe_self_care_candidate',
};

const CONV_MODE = {
  PAIN_SUPPORT: 'pain_support',
  SPORTS_OVERUSE: 'sports_overuse_support',
  SELF_STRETCH: 'self_stretch_request',
  GOAL_SUPPORT: 'goal_support',
  MOVEMENT_FEEDBACK: 'movement_feedback',
};

const STANDARD_CONFIRM = [
  '痛みの強さ（0〜10）',
  'いつからか',
  '動かすと悪化するか',
  'しびれの有無',
  '力が入りにくいか',
  '転倒・外傷の有無',
  '腫れ・熱感の有無',
  '夜間痛',
  '歩行困難',
  '排尿排便の異常（腰痛時）',
  '既往歴',
  '年齢・骨粗しょう症リスク',
];

const SHIN_SPLINT_CONFIRM = [
  'いつから痛いか',
  '走る・ジャンプで悪化するか',
  'すね内側が広く痛いか、一点が強く痛いか',
  '片脚ジャンプで強く痛むか',
  '歩いても痛いか',
  '腫れ・熱感があるか',
  '休んでも痛みが残るか',
];

function entry(id, labels, bodyRegion, category, defaultRisk, modes, cautionNotes = [], extraConfirm = []) {
  return {
    id,
    labels: Array.isArray(labels) ? labels : [labels],
    bodyRegion,
    category,
    defaultRisk,
    conversationModes: modes,
    cautionNotes,
    confirmQuestions: [...STANDARD_CONFIRM, ...extraConfirm],
  };
}

const CONDITIONS = [
  // 腰・骨盤
  entry('spinal_stenosis', ['脊柱管狭窄症', '脊柱管狭窄'], BODY_REGION.LUMBAR_PELVIS, 'degenerative', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT], ['長く反る・腰反らしは避ける', '歩行でしびれ・休むと楽は確認', '椅子で丸める・骨盤運動は低負荷から']),
  entry('spondylolysis', ['分離すべり症', '分離滑脱'], BODY_REGION.LUMBAR_PELVIS, 'structural', RISK.NEEDS_MEDICAL, [CONV_MODE.PAIN_SUPPORT]),
  entry('lumbar_hernia', ['腰椎椎間板ヘルニア', '椎間板ヘルニア', 'ヘルニア'], BODY_REGION.LUMBAR_PELVIS, 'disc', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT], ['しびれ・筋力低下・排尿排便異常を確認', '脚に広がる動きは避ける', '楽になる方向を優先']),
  entry('acute_low_back', ['ぎっくり腰', '急性腰痛'], BODY_REGION.LUMBAR_PELVIS, 'acute', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH], ['初期は強いストレッチ禁止', '楽な姿勢・短い歩行・軽い骨盤運動', '痛みが落ち着いてから可動域']),
  entry('sciatica', ['坐骨神経痛', '坐骨'], BODY_REGION.LUMBAR_PELVIS, 'nerve', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT], ['しびれ・排尿排便異常を確認']),
  entry('chronic_low_back', ['慢性腰痛', '腰が重い', '腰の重さ', '腰がつらい'], BODY_REGION.LUMBAR_PELVIS, 'chronic', RISK.SAFE_SELF_CARE, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH]),

  // 姿勢・脊柱
  entry('kyphosis', ['猫背'], BODY_REGION.SPINE_POSTURE, 'posture', RISK.SAFE_SELF_CARE, [CONV_MODE.SELF_STRETCH], ['胸を開く・肩甲骨は軽く']),
  entry('scoliosis', ['側弯症'], BODY_REGION.SPINE_POSTURE, 'posture', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('straight_neck', ['ストレートネック', 'スマホ首'], BODY_REGION.NECK_HEAD, 'posture', RISK.SAFE_SELF_CARE, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH], ['首肩の軽い可動域・胸開き']),

  // 頚部・頭部
  entry('stiff_neck', ['寝違え', '首が回らない'], BODY_REGION.NECK_HEAD, 'acute', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('headache', ['頭痛'], BODY_REGION.NECK_HEAD, 'symptom', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('cervical_spondylosis', ['頚椎症', '変形性頚椎症'], BODY_REGION.NECK_HEAD, 'degenerative', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('cervicobrachial', ['頸肩腕症候群'], BODY_REGION.NECK_HEAD, 'nerve', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('shoulder_stiffness', ['肩こり'], BODY_REGION.NECK_HEAD, 'myofascial', RISK.SAFE_SELF_CARE, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH]),
  entry('eye_strain', ['眼精疲労'], BODY_REGION.NECK_HEAD, 'symptom', RISK.SAFE_SELF_CARE, [CONV_MODE.PAIN_SUPPORT]),
  entry('tmj', ['顎関節症', '顎が痛'], BODY_REGION.NECK_HEAD, 'tmj', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),

  // 肩
  entry('frozen_shoulder', ['五十肩', '肩関節周囲炎'], BODY_REGION.SHOULDER, 'shoulder', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH], ['強い痛みの時期は無理に上げない', 'ペンデュラム・痛くない範囲', '夜間痛が強い場合は注意']),
  entry('impingement', ['インピンジメント', 'インピンジ'], BODY_REGION.SHOULDER, 'shoulder', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT], ['痛い角度の反復は避ける', '肩甲骨・外旋・姿勢を軽く']),
  entry('rotator_cuff', ['腱板損傷', '腱板'], BODY_REGION.SHOULDER, 'shoulder', RISK.NEEDS_MEDICAL, [CONV_MODE.PAIN_SUPPORT], ['強い筋トレはしない']),
  entry('shoulder_raise_difficulty', ['肩が上がりにくい', '肩が上がらない'], BODY_REGION.SHOULDER, 'shoulder', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH]),

  // 股関節・膝
  entry('hip_oa', ['変形性股関節症'], BODY_REGION.HIP_KNEE, 'oa', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('knee_oa', ['変形性膝関節症', '膝が痛い'], BODY_REGION.HIP_KNEE, 'oa', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SELF_STRETCH], ['深い膝曲げ・痛い階段反復は避ける', '大腿四頭筋・股関節・ふくらはぎ低負荷', '椅子立ち座りから']),
  entry('muscle_tension_joint', ['筋緊張による関節痛'], BODY_REGION.HIP_KNEE, 'myofascial', RISK.SAFE_SELF_CARE, [CONV_MODE.PAIN_SUPPORT]),
  entry('quadriceps_tendinitis', ['大腿四頭筋炎'], BODY_REGION.HIP_KNEE, 'tendon', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('growing_pain', ['成長痛'], BODY_REGION.HIP_KNEE, 'pediatric', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),

  // 足部・下腿（シンスプリント含む）
  entry('achilles_tendinitis', ['アキレス腱炎'], BODY_REGION.LOWER_LEG, 'tendon', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SPORTS_OVERUSE]),
  entry('shin_splint', ['シンスプリント', '脛骨過労性骨膜炎', 'shin splints', 'medial tibial stress syndrome', 'MTSS', 'すねの内側', '走るとすね'], BODY_REGION.LOWER_LEG, 'overuse_sports_injury', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT, CONV_MODE.SPORTS_OVERUSE, CONV_MODE.SELF_STRETCH], ['走る・ジャンプ量を増やさない', '一点鋭痛・片脚ジャンプ痛は医療確認', '休んでも痛い・歩行痛は注意'], SHIN_SPLINT_CONFIRM),

  // 手・肘
  entry('de_quervain', ['フィンケルシュタイン症候群', 'フィンケルシュタイン', '親指の腱鞘炎'], BODY_REGION.HAND_ELBOW, 'tendon', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('wrist_arthritis', ['手関節炎'], BODY_REGION.HAND_ELBOW, 'oa', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('trigger_finger', ['ばね指'], BODY_REGION.HAND_ELBOW, 'tendon', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('snapping_hip', ['ばね股'], BODY_REGION.HIP_KNEE, 'hip', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('baseball_elbow', ['野球肘'], BODY_REGION.HAND_ELBOW, 'overuse', RISK.NEEDS_CAUTION, [CONV_MODE.SPORTS_OVERUSE]),
  entry('tennis_elbow', ['テニス肘'], BODY_REGION.HAND_ELBOW, 'overuse', RISK.NEEDS_CAUTION, [CONV_MODE.SPORTS_OVERUSE, CONV_MODE.PAIN_SUPPORT]),

  // 外傷
  entry('fracture', ['骨折'], BODY_REGION.TRAUMA, 'trauma', RISK.RED_FLAG, [CONV_MODE.PAIN_SUPPORT]),
  entry('sprain', ['捻挫'], BODY_REGION.TRAUMA, 'trauma', RISK.NEEDS_MEDICAL, [CONV_MODE.PAIN_SUPPORT]),
  entry('dislocation', ['脱臼'], BODY_REGION.TRAUMA, 'trauma', RISK.RED_FLAG, [CONV_MODE.PAIN_SUPPORT]),
  entry('contusion', ['打撲'], BODY_REGION.TRAUMA, 'trauma', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT]),
  entry('fall_injury', ['転んで', '転倒', '転ん'], BODY_REGION.TRAUMA, 'trauma', RISK.RED_FLAG, [CONV_MODE.PAIN_SUPPORT]),

  // 全身
  entry('osteoporosis', ['骨粗しょう症', '骨粗鬆症'], BODY_REGION.SYSTEMIC, 'bone', RISK.NEEDS_CAUTION, [CONV_MODE.PAIN_SUPPORT], ['強い捻り・勢いの前屈・転倒リスクに注意', 'バランス・安全な筋力維持を優先']),
];

function normalizeText(v) {
  return String(v || '').trim();
}

function matchConditions(text = '') {
  const t = normalizeText(text);
  const matched = [];
  for (const c of CONDITIONS) {
    if (c.labels.some((label) => t.includes(label))) {
      matched.push(c);
    }
  }
  return matched;
}

function getPrimaryCondition(text = '') {
  const matched = matchConditions(text);
  return matched[0] || null;
}

function getConfirmQuestions(text = '', matched = null) {
  const list = matched || matchConditions(text);
  const questions = new Set(STANDARD_CONFIRM);
  for (const c of list) {
    for (const q of c.confirmQuestions || []) questions.add(q);
  }
  if (/すね|脛|走る|ジャンプ|シンスプリント|shin/i.test(text)) {
    for (const q of SHIN_SPLINT_CONFIRM) questions.add(q);
  }
  return [...questions];
}

function getCautionNotes(text = '', matched = null) {
  const list = matched || matchConditions(text);
  const notes = [];
  for (const c of list) {
    notes.push(...(c.cautionNotes || []));
  }
  return [...new Set(notes)];
}

function inferBodyRegion(text = '', matched = null) {
  const list = matched || matchConditions(text);
  if (list.length) return list[0].bodyRegion;
  if (/腰|骨盤|ぎっくり/.test(text)) return BODY_REGION.LUMBAR_PELVIS;
  if (/首|肩こり|ストレートネック|頭痛/.test(text)) return BODY_REGION.NECK_HEAD;
  if (/肩|五十肩/.test(text)) return BODY_REGION.SHOULDER;
  if (/膝|股関節/.test(text)) return BODY_REGION.HIP_KNEE;
  if (/すね|脛|ふくらはぎ|足首|アキレス/.test(text)) return BODY_REGION.LOWER_LEG;
  if (/肘|手首|手/.test(text)) return BODY_REGION.HAND_ELBOW;
  if (/胸|息/.test(text)) return BODY_REGION.SYSTEMIC;
  return 'general';
}

module.exports = {
  BODY_REGION,
  RISK,
  CONV_MODE,
  CONDITIONS,
  matchConditions,
  getPrimaryCondition,
  getConfirmQuestions,
  getCautionNotes,
  inferBodyRegion,
  STANDARD_CONFIRM,
  SHIN_SPLINT_CONFIRM,
};
