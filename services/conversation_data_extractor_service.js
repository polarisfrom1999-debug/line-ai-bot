'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function matches(text, re) {
  return re.test(normalizeText(text));
}

function pushIf(arr, condition, value) {
  if (condition) arr.push(value);
}

function extractConversationData(params = {}) {
  const text = normalizeText(params.text || params.userText || '');
  const out = {
    meal_items: [],
    exercise_logs: [],
    movement_symptoms: [],
    body_metrics: [],
    medication_mentions: [],
    lab_mentions: [],
    athlete_training_logs: [],
    life_context_notes: [],
    emotional_notes: [],
    goal_updates: [],
    profile_update_candidates: [],
  };
  if (!text) return out;

  const mealTerms = ['ラーメン', 'きなこ', 'すりごま', '作り置き', 'コンビニ', '白湯', '卵', 'ヨーグルト', 'アボカド', '水分'];
  for (const term of mealTerms) {
    if (text.includes(term)) out.meal_items.push({ item: term, source_text: text.slice(0, 120) });
  }
  pushIf(out.meal_items, matches(text, /食べちゃ|食べました|飲みました|外食/), { item: '食事報告', source_text: text.slice(0, 120) });

  const exerciseMatch = text.match(/(\d+)\s*(分|回|km|キロ|本)/);
  pushIf(out.exercise_logs, matches(text, /ウォーキング|ジョギング|ランニング|ストレッチ|筋トレ|スクワット|歩き|歩け|走りました|走った/), {
    activity: text.slice(0, 80),
    amount_hint: exerciseMatch ? exerciseMatch[0] : null,
  });

  pushIf(out.movement_symptoms, matches(text, /腰痛|腰|膝|肩|首|ハム|張|痛|しびれ|違和感|むくみ|頭痛/), {
    symptom_text: text.slice(0, 120),
  });

  const weight = text.match(/体重\s*([0-9]+(?:\.[0-9]+)?)/);
  const bodyFat = text.match(/体脂肪(?:率)?\s*([0-9]+(?:\.[0-9]+)?)/);
  const bloodPressure = text.match(/血圧\s*([0-9]{2,3})\s*[\/／]\s*([0-9]{2,3})/);
  if (weight) out.body_metrics.push({ type: 'weight', value: Number(weight[1]) });
  if (bodyFat) out.body_metrics.push({ type: 'body_fat', value: Number(bodyFat[1]) });
  if (bloodPressure) out.body_metrics.push({ type: 'blood_pressure', systolic: Number(bloodPressure[1]), diastolic: Number(bloodPressure[2]) });
  pushIf(out.body_metrics, matches(text, /睡眠不足|寝不足|便通|便秘|食欲|安静時心拍/), { type: 'body_condition_text', text: text.slice(0, 120) });

  const meds = ['シナール', '薬', '処方', '服薬', '中止'];
  for (const med of meds) {
    if (text.includes(med)) out.medication_mentions.push({ name: med, source_text: text.slice(0, 120) });
  }

  const labs = ['尿酸', 'LDL', 'HDL', '中性脂肪', 'TG', 'クレアチニン', '尿素窒素', 'AST', 'ALT', 'HbA1c', '血液検査'];
  for (const lab of labs) {
    if (text.toUpperCase().includes(lab.toUpperCase())) out.lab_mentions.push({ item: lab, source_text: text.slice(0, 120) });
  }

  pushIf(out.athlete_training_logs, matches(text, /100m|200m|400m|800m|1500m|タイム|レスト|\d+\s*本|走りました/), {
    training_text: text.slice(0, 120),
  });

  pushIf(out.life_context_notes, matches(text, /仕事|育児|家族|母|父|旅行|買い出し|作り置き|外食|睡眠不足|コンビニ/), {
    note: text.slice(0, 120),
  });

  pushIf(out.emotional_notes, matches(text, /不安|迷|罪悪感|嬉し|疲れ|寂し|嫌|つら|心配|安心|自信|悔し/), {
    emotion_text: text.slice(0, 120),
  });

  pushIf(out.goal_updates, matches(text, /目標|達成|タイム|旅行|改善/), {
    goal_text: text.slice(0, 120),
  });

  out.meal_items = out.meal_items.slice(0, 8);
  out.exercise_logs = out.exercise_logs.slice(0, 5);
  out.movement_symptoms = out.movement_symptoms.slice(0, 5);
  out.body_metrics = out.body_metrics.slice(0, 5);
  out.medication_mentions = out.medication_mentions.slice(0, 5);
  out.lab_mentions = out.lab_mentions.slice(0, 8);
  out.athlete_training_logs = out.athlete_training_logs.slice(0, 5);
  out.life_context_notes = out.life_context_notes.slice(0, 5);
  out.emotional_notes = out.emotional_notes.slice(0, 5);
  out.goal_updates = out.goal_updates.slice(0, 5);

  out.profile_update_candidates = buildConversationProfileUpdateCandidate({
    text,
    extraction: out,
    understanding: params.conversationUnderstanding || params.understanding || {},
  });

  return out;
}

function buildConversationProfileUpdateCandidate(params = {}) {
  const text = normalizeText(params.text || '');
  const understanding = params.understanding || {};
  const profile = {
    conversation_profile: {
      decision_style: null,
      motivation_source: [],
      support_style: [],
      risk_patterns: [],
      trust_builders: [],
      preferred_reply_depth: {},
      praise_preference: null,
      anticipatory_support_preference: null,
    },
    reason: understanding.reason || 'profile_candidate_from_text',
  };

  if (matches(text, /買い出し|作り置き|変えていい|大丈夫|確認/)) {
    profile.conversation_profile.decision_style = 'checks_before_action';
    profile.conversation_profile.support_style.push('reasoned_explanation', 'anticipatory_support');
    profile.conversation_profile.trust_builders.push('specific_amounts');
    profile.conversation_profile.anticipatory_support_preference = true;
  }
  if (matches(text, /何を買えば|どれ|選び方|理由/)) {
    profile.conversation_profile.support_style.push('choice_organization');
    profile.conversation_profile.trust_builders.push('specific_amounts');
  }
  if (matches(text, /不安|心配|迷/)) {
    profile.conversation_profile.decision_style = profile.conversation_profile.decision_style || 'needs_reassurance';
    profile.conversation_profile.support_style.push('gentle_boundary');
  }
  if (matches(text, /目標達成|できました|走りました|続け/)) {
    profile.conversation_profile.motivation_source.push('praise', 'goal_progress');
    profile.conversation_profile.praise_preference = 'light_to_normal';
  }
  if (matches(text, /やめてもいい|中止|強い痛|しびれ|死にたい/)) {
    profile.conversation_profile.risk_patterns.push(matches(text, /死にたい/) ? 'self_blame' : 'pain_ignoring');
    profile.conversation_profile.trust_builders.push('medical_collaboration');
  }
  if (understanding.reply_depth) {
    profile.conversation_profile.preferred_reply_depth[understanding.conversation_purpose || 'unknown'] = understanding.reply_depth;
  }

  const cp = profile.conversation_profile;
  cp.motivation_source = uniq(cp.motivation_source);
  cp.support_style = uniq(cp.support_style);
  cp.risk_patterns = uniq(cp.risk_patterns);
  cp.trust_builders = uniq(cp.trust_builders);
  return profile;
}

module.exports = {
  extractConversationData,
  buildConversationProfileUpdateCandidate,
};
