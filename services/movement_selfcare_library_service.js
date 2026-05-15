'use strict';

const { BODY_REGION } = require('./movement_condition_map_service');

function menu(id, bodyRegion, purpose, suitableFor, avoidIf, instructions, reps, intensity, stopCondition, progression, regression) {
  return {
    id,
    bodyRegion,
    purpose,
    suitableFor,
    avoidIf,
    instructions,
    reps,
    intensity,
    stopCondition,
    progression,
    regression,
  };
}

const MENUS = [
  // 腰
  menu('pelvic_rock', BODY_REGION.LUMBAR_PELVIS, '骨盤の可動域', ['腰の重さ', '慢性腰痛', '脊柱管狭窄の低負荷'], ['鋭い腰痛', 'しびれ増加', 'ぎっくり腰急性期'], '椅子に座り、骨盤を前後に小さく動かす', '10回', '痛み0〜3、気持ちいい張りまで', '痛み増・しびれ・足の違和感で中止', '翌日12回', '仰向けで膝倒し'),
  menu('knee_drop', BODY_REGION.LUMBAR_PELVIS, '腰回転の緩和', ['腰のこわばり', '慢性腰痛'], ['急性のぎっくり腰', '脚しびれ'], '仰向けで膝を立て、両膝をゆっくり左右に倒す', '10回', '0〜3', 'しびれ・痛み増で中止', '12〜15回', '片膝だけ'),
  menu('knee_hug', BODY_REGION.LUMBAR_PELVIS, '腰背部の緩和', ['張り', '慢性腰痛'], ['急性期強痛'], '仰向けで片膝を胸に近づける', '各10秒×1〜2', '0〜3', '痛み増で中止', '20秒', '両膝は無理に引き寄せない'),
  menu('cat_cow', BODY_REGION.LUMBAR_PELVIS, '脊柱の可動域', ['こわばり'], ['狭窄で反りがつらい', '急性腰痛'], '四つ這いで背中を丸めたり反らしたり', '8〜10回', '0〜3', 'しびれ・痛み増で中止', '12回', '椅子で骨盤前後'),
  menu('chair_pelvic', BODY_REGION.LUMBAR_PELVIS, '座位骨盤運動', ['脊柱管狭窄', '歩行でしびれ'], ['立位がつらい時以外の深い反り'], '椅子に座り骨盤を前後', '10回', '0〜3', 'しびれ増で中止', '12回', '5回から'),
  menu('draw_in', BODY_REGION.LUMBAR_PELVIS, '体幹安定', ['慢性腰痛予防'], ['急性強痛'], '仰向けでお腹を軽く引く', '5〜10回×5秒', '0〜2', '息止め・痛みで中止', '10秒保持', '座位で'),
  menu('hip_lift_light', BODY_REGION.LUMBAR_PELVIS, 'お尻・腰補助', ['慢性腰痛'], ['急性腰痛', '骨粗鬆症で転倒リスク'], '仰向けでお尻を軽く持ち上げる', '5〜8回', '0〜3', '腰の鋭痛で中止', '10回', '片脚は後から'),
  menu('sit_to_stand', BODY_REGION.LUMBAR_PELVIS, '生活動作', ['変形性膝・腰の立ち上がり'], ['膝・腰の強痛'], '椅子からゆっくり立ち座り', '5回', '0〜3', '痛み増で中止', '8回', '高い椅子'),

  // 首・肩
  menu('scapula_squeeze', BODY_REGION.SHOULDER, '肩甲骨コントロール', ['肩こり', 'インピンジメント', '猫背'], ['急性強痛'], '肘を軽く曲げ肩甲骨を寄せる', '10回', '0〜3', 'ズキッとする痛みで中止', '12回', '肩すくめ脱力のみ'),
  menu('shoulder_shrug_drop', BODY_REGION.SHOULDER, '肩の脱力', ['肩こり', '五十肩初期'], ['強い夜間痛のみで動かせない'], '肩をすくめてストンと落とす', '10回', '0〜3', '痛み増で中止', '12回', '片肩ずつ'),
  menu('chest_open', BODY_REGION.SHOULDER, '胸郭伸展', ['猫背', 'ストレートネック'], ['首の鋭痛'], '胸を軽く開くストレッチ', '10〜20秒×1〜2', '0〜3', 'しびれ・痛み増', '20秒×2', '座位で'),
  menu('neck_rotation_light', BODY_REGION.NECK_HEAD, '首回旋', ['寝違え軽症', '肩こり'], ['激しい首痛', 'ろれつ障害疑い'], '首をゆっくり左右に振る', '各5〜8回', '0〜2', 'しびれ・痛み増', '10回', '目線だけ'),
  menu('towel_extension', BODY_REGION.SPINE_POSTURE, '胸椎伸展補助', ['猫背'], ['骨粗鬆症で強い反り不安'], 'タオルを背中に当て軽く仰る', '5〜8回', '0〜2', '痛み増', '10回', '胸開きのみ'),
  menu('pendulum', BODY_REGION.SHOULDER, '五十肩・可動域', ['五十肩', '肩が上がりにくい'], ['急性骨折疑い'], '前傾して腕をゆらす', '10〜20秒', '0〜3', '鋭痛で中止', '30秒', '仰向けで腕上げ補助'),
  menu('wall_slide', BODY_REGION.SHOULDER, '肩屈曲可動域', ['インピンジメント'], ['痛い角度で反復'], '壁に手のひらを付け上げ下げ', '8〜10回', '0〜3', 'ズキッと痛みで中止', '12回', '痛くない範囲のみ'),
  menu('external_rotation_band', BODY_REGION.SHOULDER, '外旋', ['腱板・インピンジ'], ['強い肩痛'], 'チューブで外旋', '10回', '0〜2', '痛み増', '12回', '肘を体側に'),

  // 膝
  menu('quad_set', BODY_REGION.HIP_KNEE, '大腿四頭筋活性', ['膝痛', '変形性膝'], ['膝の強い腫れ'], '膝を伸ばしたまま大腿を締める', '10回×5秒', '0〜3', '膝の鋭痛', '12回', '座位で'),
  menu('leg_raise', BODY_REGION.HIP_KNEE, '膝伸展補助', ['膝OA'], ['急性膝損傷'], '仰向けで膝を伸ばして足を上げる', '5〜8回', '0〜3', '痛み増', '10回', '片脚'),
  menu('calf_raise_light', BODY_REGION.LOWER_LEG, 'ふくらはぎ', ['膝・足首補助'], ['アキレス急性期'], 'つま先立ちを軽く', '5〜10回', '0〜3', 'すね・かかとの鋭痛', '12回', '両脚のみ'),
  menu('hamstring_light', BODY_REGION.HIP_KNEE, 'ハムストレッチ', ['膝裏の張り'], ['坐骨神経痛でしびれ増'], '仰向けで膝を伸ばして軽く', '10〜20秒', '0〜3', 'しびれ増', '20秒×2', '短い範囲'),
  menu('clam_shell', BODY_REGION.HIP_KNEE, '股関節外転', ['膝内側痛', '股関節'], ['強い膝痛'], '横向きで膝を開く', '8〜10回', '0〜3', '痛み増', '12回', '小さく'),

  // 股関節
  menu('glute_stretch', BODY_REGION.HIP_KNEE, 'お尻ストレッチ', ['腰・股関節'], ['急性強痛'], '椅子に座り足首を膝に', '10〜20秒', '0〜3', 'しびれ増', '20秒×2', '短く'),
  menu('hip_circle', BODY_REGION.HIP_KNEE, '股関節可動域', ['こわばり'], ['強い股関節痛'], '立位で小さく股関節を回す', '各方向5回', '0〜3', '痛み増', '8回', '座位で'),

  // 肘・手
  menu('wrist_ext_stretch', BODY_REGION.HAND_ELBOW, '前腕伸筋', ['テニス肘'], ['急性骨折'], '腕を伸ばし手首を下げる', '10〜20秒', '0〜3', '鋭痛', '20秒×2', '短く'),
  menu('wrist_flex_stretch', BODY_REGION.HAND_ELBOW, '前腕屈筋', ['ゴルフ肘様'], ['急性'], '手首を上に曲げる', '10〜20秒', '0〜3', '鋭痛', '20秒×2', '短く'),
  menu('gripper_towel', BODY_REGION.HAND_ELBOW, '握力', ['手首・ばね指'], ['強い腫れ'], 'タオルを軽く握る', '10回', '0〜3', '痛み増', '12回', '握らない'),
  menu('wrist_mobility', BODY_REGION.HAND_ELBOW, '手首可動域', ['手首のこわばり'], ['骨折疑い'], '手首をゆっくり回す', '各方向5〜10回', '0〜3', '痛み増', '10回', '片方向のみ'),

  // 足・アキレス・シンスプリント
  menu('calf_stretch', BODY_REGION.LOWER_LEG, 'ふくらはぎストレッチ', ['アキレス', 'シンスプリント', 'すねの張り'], ['一点の鋭痛', '片脚ジャンプ痛'], '壁を使いすねを軽く伸ばす', '10〜20秒×1〜2', '0〜3', 'すねの鋭痛・しびれで中止', '20秒×2', '膝を曲げた版'),
  menu('ankle_circle', BODY_REGION.LOWER_LEG, '足首可動域', ['シンスプリント', '足首こわばり'], ['急性捻挫腫れ'], '足首をゆっくり回す', '左右10回', '0〜3', '痛み増', '12回', '片方向5回'),
  menu('towel_gather', BODY_REGION.LOWER_LEG, '足裏・足指', ['シンスプリント', '扁平足補助'], ['足底強痛'], 'タオルを足で掴む', '10回', '0〜3', '足底鋭痛', '12回', '5回'),
  menu('calf_raise_bilateral', BODY_REGION.LOWER_LEG, 'ふくらはぎ筋', ['シンスプリント回復期'], ['走ると痛い', '一点痛', '片脚ジャンプ痛'], '両脚でかかとを上げる', '5〜10回', '0〜3', 'すね鋭痛で中止', '12回', '片脚は禁止'),
  menu('shin_self_massage_light', BODY_REGION.LOWER_LEG, 'すね周囲', ['シンスプリント・張り'], ['一点鋭痛', '腫れ熱感'], '骨を押さず筋肉を軽く流す', '30秒〜1分', '0〜2', '鋭痛・腫れ増', '1分', 'しない'),
];

const REGION_ALIASES = {
  lumbar_pelvis: BODY_REGION.LUMBAR_PELVIS,
  spine_posture: BODY_REGION.SPINE_POSTURE,
  neck_head: BODY_REGION.NECK_HEAD,
  shoulder: BODY_REGION.SHOULDER,
  hip_knee: BODY_REGION.HIP_KNEE,
  lower_leg: BODY_REGION.LOWER_LEG,
  hand_elbow: BODY_REGION.HAND_ELBOW,
  general: null,
};

function pickMenus({ bodyRegion = 'general', conditionIds = [], safetyLevel = 'safe_self_care_candidate', text = '' } = {}) {
  if (safetyLevel === 'red_flag' || safetyLevel === 'needs_medical_check') return [];

  const region = REGION_ALIASES[bodyRegion] || bodyRegion;
  let pool = MENUS.filter((m) => !region || m.bodyRegion === region || region === 'general');

  if (/シンスプリント|すね.*内側|走るとすね|shin|MTSS/i.test(text) || conditionIds.includes('shin_splint')) {
    const shinMenus = MENUS.filter((m) =>
      ['calf_stretch', 'ankle_circle', 'towel_gather', 'calf_raise_bilateral', 'shin_self_massage_light'].includes(m.id)
    );
    pool = [...shinMenus, ...pool];
  }
  if (/五十肩|肩が上がり/.test(text)) {
    pool = [...MENUS.filter((m) => ['pendulum', 'scapula_squeeze', 'shoulder_shrug_drop'].includes(m.id)), ...pool];
  }
  if (/脊柱管|狭窄/.test(text)) {
    pool = [...MENUS.filter((m) => ['chair_pelvic', 'pelvic_rock'].includes(m.id)), ...pool];
  }
  if (/ぎっくり|急性腰痛/.test(text)) {
    pool = [...MENUS.filter((m) => ['pelvic_rock', 'knee_hug', 'chair_pelvic'].includes(m.id)), ...pool];
  }
  if (/変形性膝|膝が痛/.test(text)) {
    pool = [...MENUS.filter((m) => ['quad_set', 'sit_to_stand', 'clam_shell'].includes(m.id)), ...pool];
  }

  const seen = new Set();
  const unique = [];
  for (const m of pool) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    unique.push(m);
  }
  return unique.slice(0, 3);
}

function selectBestMenu(params = {}) {
  const menus = pickMenus(params);
  return menus[0] || null;
}

function formatMenuForPrompt(menuItem) {
  if (!menuItem) return '';
  return [
    `提案メニュー: ${menuItem.purpose}`,
    `やり方: ${menuItem.instructions}`,
    `回数: ${menuItem.reps}`,
    `強さ: ${menuItem.intensity}`,
    `中止: ${menuItem.stopCondition}`,
  ].join('\n');
}

function formatMenuForReply(menuItem) {
  if (!menuItem) return '';
  return [
    menuItem.instructions,
    `まず${menuItem.reps}だけ。`,
    menuItem.stopCondition,
    'できたら「できた」で大丈夫です。',
  ].join('\n');
}

module.exports = {
  MENUS,
  pickMenus,
  selectBestMenu,
  formatMenuForPrompt,
  formatMenuForReply,
};
