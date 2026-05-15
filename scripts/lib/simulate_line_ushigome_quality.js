'use strict';

/**
 * 実会話由来シナリオの返信品質（ルートだけでなく文面）。
 * 定型文バンクではなく、判断構造が反映されているかを見る。
 */

function normalizeText(v) {
  return String(v || '').trim();
}

const GENERIC_ONLY_RE = /^(大丈夫です|無理なく|無理せず|一緒に頑張りましょう|いい流れです)[。！]?$/;
const BLAME_RE = /(反省し|禁物|だめだ|ダメだ|やりすぎ|最悪|失敗した|叱って|罰|甘え|自制しろ)/;
const PUSH_EXERCISE_RE = /(もっと|さらに|増やし|頑張って|追い込|全力で).*(運動|スクワット|走|筋トレ)/;
const WEIGHT_FAIL_RE = /(失敗した|ダメです|反省した|落ち込んで|落ちたね残念)/;
const PRAISE_WEIGHT_LOSS_ONLY_RE = /(痩せ|減り|順調|素晴らしい).*(素晴らしい|すごい|順調)/;
const NUMBERS_ONLY_RE = /^(手入力の目安|今日の合計).+$/m;
const HEALTH_APP_ONLY_RE = /(記録しました|いい流れです|ここまでの流れを一本|急がず今日はこの一歩で十分|雑談もちゃんと受け止め)/;
const BIG_STEP_RE = /(毎日|毎回|1時間|100回|10km|完璧|絶対|必ず全部|フルマラソン)/;

function hasDirectReaction(userText, reply) {
  const u = normalizeText(userText);
  const r = normalizeText(reply);
  if (!u || !r) return false;
  if (/おはぎ|お萩/.test(u) && /おはぎ|お萩/.test(r)) return true;
  if (/スクワット/.test(u) && /スクワット/.test(r)) return true;
  if (/縄跳び|エアー/.test(u) && /縄跳び/.test(r)) return true;
  if (/草むしり/.test(u) && /草むしり/.test(r)) return true;
  if (/抱っこ/.test(u) && /抱っこ/.test(r)) return true;
  if (/お茶会/.test(u) && /お茶会/.test(r)) return true;
  if (/劇団/.test(u) && /劇団/.test(r)) return true;
  if (/寝不足/.test(u) && /寝|睡眠|休息/.test(r)) return true;
  if (/頭痛/.test(u) && /頭痛/.test(r)) return true;
  if (/半分/.test(u) && /半分|調整/.test(r)) return true;
  const keywords = u.match(/[ぁ-んァ-ヶ一-龥a-zA-Z]{2,}/g) || [];
  const hits = keywords.filter((w) => w.length >= 2 && r.includes(w));
  return hits.length >= 1 || r.length >= 20;
}

function hasConcretePraiseOrObservation(reply) {
  return /(半分|調整|報告|続け|工夫|意識|楽に|休息|水分|糖質|たんぱく|抱っこ|草むしり|外食|お茶会|劇団|スクワット|ストレッチ|痛み|頭痛|便|睡眠|写真|忘れ|戻|整え|体調|受け取|塩分|一喜一憂|増え|体重)/.test(
    String(reply || '')
  );
}

function isGenericOnly(reply) {
  const lines = String(reply || '')
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!lines.length) return true;
  return lines.every((line) => GENERIC_ONLY_RE.test(line) || /^なるほど。今の感じは受け取れた/.test(line));
}

const SCENARIO_RULES = {
  reward_ohagi: {
    mustNot: [BLAME_RE, WEIGHT_FAIL_RE],
    must: [/(次|整え|1個|戻|責め|大丈夫|ご褒美|おはぎ)/],
    requireConcrete: true,
  },
  weight_gain: {
    mustNot: [WEIGHT_FAIL_RE, BLAME_RE],
    must: [/(塩分|水分|睡眠|むくみ|便|前日|一喜一憂|戻)/],
    requireConcrete: true,
  },
  low_appetite: {
    mustNot: [PRAISE_WEIGHT_LOSS_ONLY_RE],
    must: [/(体調|糖質|たんぱく|水分|休息|無理|食べ)/],
    requireConcrete: true,
  },
  half_portion: {
    must: [/(半分|調整|我慢では|整え|食事|教えて)/],
    mustNot: [BLAME_RE],
    requireConcrete: true,
  },
  photo_forgot: {
    mustNot: [BLAME_RE],
    must: [/(大丈夫|後から|文字|送って|忘れ)/],
    requireConcrete: true,
  },
  stretch_pain_relief: {
    must: [/(楽|軽|ストレッチ|痛|腰|身体)/],
    mustNot: [PUSH_EXERCISE_RE],
    requireConcrete: true,
  },
  squat_with_pain: {
    must: [/(痛|足|膝|中止|フォーム|無理|確認)/],
    mustNot: [PUSH_EXERCISE_RE],
    requireConcrete: true,
  },
  squat_20: {
    must: [/(スクワット|20|回|続)/],
    mustNot: [PUSH_EXERCISE_RE],
    requireConcrete: true,
  },
  jump_rope: {
    must: [/(縄跳び|エアー|運動|分)/],
    requireConcrete: true,
  },
  exercise_skipped: {
    mustNot: [WEIGHT_FAIL_RE, BLAME_RE],
    must: [/(休|調整|無理|明日|肩|小さ)/],
    requireConcrete: true,
  },
  child_carry: {
    must: [/(抱っこ|子ども|歩|運動|腰|負担)/],
    requireConcrete: true,
  },
  theater_late: {
    must: [/(劇団|遅|睡眠|疲|明日|戻)/],
    requireConcrete: true,
  },
  weeding: {
    must: [/(草むしり|活動|運動|腰|膝)/],
    requireConcrete: true,
  },
  tea_party: {
    mustNot: [BLAME_RE],
    must: [/(お茶会|楽し|整え|次|戻)/],
    requireConcrete: true,
  },
  headache_no_appetite: {
    mustNot: [PRAISE_WEIGHT_LOSS_ONLY_RE, PUSH_EXERCISE_RE],
    must: [/(頭痛|体調|食欲|糖質|水分|休息|医)/],
    requireConcrete: true,
  },
  constipation: {
    must: [/(便|水分|野菜|汁|温か|体重|むくみ)/],
    mustNot: [/下剤を飲んで|診断/],
    requireConcrete: true,
  },
  sleep_deprived: {
    must: [/(眠|寝不足|睡眠|休|無理|強度)/],
    mustNot: [PUSH_EXERCISE_RE],
    requireConcrete: true,
  },
};

/**
 * @returns {string[]}
 */
function evaluateUshigomeScenarioQuality({ userText = '', reply = '', scenarioId = '' } = {}) {
  const violations = [];
  const rules = SCENARIO_RULES[scenarioId];
  if (!rules) return violations;

  const r = String(reply || '');
  const u = String(userText || '');

  if (!r.trim()) violations.push('ushigome_empty_reply');
  if (!hasDirectReaction(u, r)) violations.push('ushigome_no_direct_reaction');
  if (isGenericOnly(r)) violations.push('ushigome_generic_only');
  if (GENERIC_ONLY_RE.test(r.replace(/\n/g, '')) && r.length < 40) violations.push('ushigome_too_generic');

  for (const re of rules.mustNot || []) {
    if (re.test(r)) violations.push(`ushigome_forbidden:${re.source.slice(0, 24)}`);
  }
  for (const re of rules.must || []) {
    if (!re.test(r)) violations.push(`ushigome_missing:${re.source.slice(0, 24)}`);
  }
  if (rules.requireConcrete && !hasConcretePraiseOrObservation(r)) {
    violations.push('ushigome_not_concrete');
  }
  if (NUMBERS_ONLY_RE.test(r) && !hasConcretePraiseOrObservation(r)) {
    violations.push('ushigome_numbers_only');
  }
  if (/大丈夫です[。]?$/.test(r) && r.length < 35) violations.push('ushigome_ok_only');

  if (HEALTH_APP_ONLY_RE.test(r)) violations.push('ushigome_health_app_template');
  if (BIG_STEP_RE.test(r) && /(今日|明日|次は)/.test(r)) violations.push('ushigome_next_step_too_big');
  if (/一緒に頑張りましょう/.test(r) && r.length < 50) violations.push('ushigome_cheer_only');

  return violations;
}

/**
 * 仕様 §8 の共通 FAIL 条件（シナリオ横断）
 * @returns {string[]}
 */
function evaluateGlobalUshigomeFails({ userText = '', reply = '' } = {}) {
  const violations = [];
  const u = normalizeText(userText);
  const r = normalizeText(reply);
  if (!r) return ['ushigome_empty_reply'];
  if (!hasDirectReaction(u, r)) violations.push('ushigome_no_direct_reaction');
  if (NUMBERS_ONLY_RE.test(r) && !hasConcretePraiseOrObservation(r)) violations.push('ushigome_numbers_only');
  if (isGenericOnly(r)) violations.push('ushigome_generic_only');
  if (BLAME_RE.test(r)) violations.push('ushigome_blame');
  if (WEIGHT_FAIL_RE.test(r)) violations.push('ushigome_weight_fail_tone');
  if (/食欲がない|食べられない|頭痛/.test(u) && PRAISE_WEIGHT_LOSS_ONLY_RE.test(r)) {
    violations.push('ushigome_praise_loss_on_illness');
  }
  if (/痛|頭痛|寝不足|だる/.test(u) && PUSH_EXERCISE_RE.test(r)) violations.push('ushigome_push_exercise_on_pain');
  if (HEALTH_APP_ONLY_RE.test(r)) violations.push('ushigome_health_app_template');
  if (!hasConcretePraiseOrObservation(r) && r.length < 45) violations.push('ushigome_not_concrete');
  return violations;
}

module.exports = {
  evaluateUshigomeScenarioQuality,
  evaluateGlobalUshigomeFails,
  SCENARIO_RULES,
};
