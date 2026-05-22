'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function hasAny(text, re) {
  return re.test(normalizeText(text));
}

function baseUnderstanding(reason = 'conversation_core_default') {
  return {
    conversation_purpose: 'daily_chat',
    emotional_state: 'neutral',
    user_need: 'listen',
    reply_depth: 'normal',
    feature_plan: ['none'],
    data_extraction_targets: ['conversation_profile_update'],
    praise_target: null,
    praise_intensity: 'none',
    anticipatory_support_needed: false,
    safety_level: 'normal',
    max_questions: 1,
    reason,
  };
}

function analyzeConversation(params = {}) {
  const text = normalizeText(params.text || params.userText || '');
  const out = baseUnderstanding('conversation_core_rule_default');
  if (!text) return out;

  const feature = [];
  const targets = ['conversation_profile_update'];

  if (hasAny(text, /死にたい|消えたい|自傷|自殺|いなくなりたい/)) {
    Object.assign(out, {
      conversation_purpose: 'crisis_or_urgent',
      emotional_state: 'overwhelmed',
      user_need: 'calm_down',
      reply_depth: 'deep',
      praise_target: 'safety_report',
      praise_intensity: 'light',
      anticipatory_support_needed: false,
      safety_level: 'urgent',
      max_questions: 1,
      reason: 'self_harm_or_crisis_language',
    });
    targets.push('emotion', 'life_context');
    out.feature_plan = ['none'];
    out.data_extraction_targets = uniq(targets);
    return out;
  }

  if (hasAny(text, /薬|シナール|服薬|飲むのをやめ|中止|処方/)) {
    Object.assign(out, {
      conversation_purpose: 'medication_question',
      emotional_state: hasAny(text, /迷|不安|心配/) ? 'uncertain' : 'neutral',
      user_need: hasAny(text, /やめ|中止/) ? 'confirm_safety' : 'choose_option',
      reply_depth: 'explain',
      feature_plan: ['medication'],
      data_extraction_targets: uniq([...targets, 'medication', 'emotion']),
      praise_target: 'question',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: 'caution',
      max_questions: 1,
      reason: 'medication_safety_boundary',
    });
    return out;
  }

  if (hasAny(text, /血液検査|検査結果|尿酸|LDL|HDL|中性脂肪|TG|クレアチニン|尿素窒素|AST|ALT|HbA1c|hba1c/)) {
    Object.assign(out, {
      conversation_purpose: 'lab_question',
      emotional_state: hasAny(text, /心配|不安|怖/) ? 'anxious' : 'uncertain',
      user_need: 'explain_reason',
      reply_depth: hasAny(text, /心配|結果|理由|どう/) ? 'explain' : 'normal',
      feature_plan: ['lab'],
      data_extraction_targets: uniq([...targets, 'lab_result', 'emotion']),
      praise_target: 'question',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'lab_question_or_lab_anxiety',
    });
    return out;
  }

  if (hasAny(text, /ラーメン|きなこ|すりごま|作り置き|買い出し|コンビニ|食べちゃ|食べました|飲みました|外食|水分/)) {
    Object.assign(out, {
      conversation_purpose: hasAny(text, /変えて|大丈夫|買えば|作り置き|買い出し|コンビニ/) ? 'practical_advice' : 'health_record',
      emotional_state: hasAny(text, /食べちゃ|不安|大丈夫/) ? 'uncertain' : 'neutral',
      user_need: hasAny(text, /なぜ|理由/) ? 'explain_reason' : (hasAny(text, /何を|どれ|変えて/) ? 'choose_option' : 'reassure'),
      reply_depth: hasAny(text, /変えて|作り置き|買い出し|コンビニ/) ? 'explain' : 'normal',
      feature_plan: ['meal', 'life_context'],
      data_extraction_targets: uniq([...targets, 'meal_log', 'life_context', 'emotion']),
      praise_target: hasAny(text, /変えて|大丈夫|買い出し|作り置き/) ? 'question' : 'safety_report',
      praise_intensity: 'light',
      anticipatory_support_needed: hasAny(text, /変えて|作り置き|買い出し|コンビニ/),
      safety_level: 'normal',
      max_questions: 1,
      reason: 'meal_record_or_practical_food_advice',
    });
    return out;
  }

  if (hasAny(text, /100m|200m|400m|800m|1500m|タイム|本走|レスト|ハム|張って|違和感|練習|走りました/)) {
    Object.assign(out, {
      conversation_purpose: hasAny(text, /痛|しびれ|張って|違和感|ハム/) ? 'movement_support' : 'athlete_training',
      emotional_state: hasAny(text, /落ち|不安|悔/) ? 'frustrated' : 'neutral',
      user_need: hasAny(text, /落ち|どう/) ? 'organize' : 'specific_instruction',
      reply_depth: hasAny(text, /タイム|本|レスト|目標/) ? 'explain' : 'normal',
      feature_plan: uniq([hasAny(text, /痛|しびれ|張って|違和感|ハム/) ? 'movement' : 'athlete', 'exercise']),
      data_extraction_targets: uniq([...targets, 'athlete_training', 'exercise_log', 'movement_symptom', 'goal']),
      praise_target: hasAny(text, /走りました|本/) ? 'action' : 'awareness',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: hasAny(text, /強い痛|しびれ|歩け/) ? 'caution' : 'normal',
      max_questions: 1,
      reason: 'athlete_or_movement_support',
    });
    return out;
  }

  if (hasAny(text, /腰|膝|肩|首|頭痛|むくみ|睡眠|便通|便秘|体重|体脂肪|血圧|心拍|痛|しびれ|歩けない/)) {
    Object.assign(out, {
      conversation_purpose: 'movement_support',
      emotional_state: hasAny(text, /心配|怖|不安/) ? 'anxious' : 'neutral',
      user_need: hasAny(text, /大丈夫|していい/) ? 'confirm_safety' : 'specific_instruction',
      reply_depth: 'normal',
      feature_plan: ['movement', 'body_condition'],
      data_extraction_targets: uniq([...targets, 'movement_symptom', 'body_metric', 'emotion']),
      praise_target: 'safety_report',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: hasAny(text, /しびれ.*歩けない|歩けない|強い痛|ろれつ|麻痺/) ? 'caution' : 'normal',
      max_questions: 1,
      reason: 'body_condition_or_movement_text',
    });
    return out;
  }

  if (hasAny(text, /母|父|家族|子ども|夫|妻/)) {
    Object.assign(out, {
      conversation_purpose: 'family_health',
      emotional_state: hasAny(text, /痛|心配|不安/) ? 'anxious' : 'neutral',
      user_need: 'organize',
      reply_depth: 'explain',
      feature_plan: ['life_context', 'body_condition'],
      data_extraction_targets: uniq([...targets, 'life_context', 'emotion']),
      praise_target: 'family_effort',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: hasAny(text, /強い痛|しびれ|歩け/) ? 'caution' : 'normal',
      max_questions: 1,
      reason: 'family_health_context',
    });
    return out;
  }

  if (hasAny(text, /旅行|出張|移動|たくさん歩/)) {
    Object.assign(out, {
      conversation_purpose: 'travel_advice',
      emotional_state: hasAny(text, /不安|心配/) ? 'anxious' : 'neutral',
      user_need: 'organize',
      reply_depth: 'explain',
      feature_plan: ['life_context', 'movement'],
      data_extraction_targets: uniq([...targets, 'life_context', 'movement_symptom', 'goal']),
      praise_target: 'question',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'travel_or_life_planning',
    });
    return out;
  }

  if (hasAny(text, /目標達成|達成しました|できました|やりました|嬉しい|よかった/)) {
    Object.assign(out, {
      conversation_purpose: 'celebration',
      emotional_state: 'happy',
      user_need: 'celebrate',
      reply_depth: 'normal',
      feature_plan: ['life_context'],
      data_extraction_targets: uniq([...targets, 'emotion', 'goal']),
      praise_target: 'achievement',
      praise_intensity: 'normal',
      anticipatory_support_needed: true,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'celebration_or_goal_progress',
    });
    return out;
  }

  if (hasAny(text, /AIでしょ|ロボット|機械|本当にわかる|試して/)) {
    Object.assign(out, {
      conversation_purpose: 'test_the_ai',
      emotional_state: 'testing',
      user_need: 'boundary',
      reply_depth: 'normal',
      feature_plan: ['none'],
      data_extraction_targets: uniq([...targets, 'emotion']),
      praise_target: null,
      praise_intensity: 'none',
      anticipatory_support_needed: false,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'ai_boundary_or_trust_test',
    });
    return out;
  }

  if (hasAny(text, /健康と関係ない|関係ない話|雑談でも|話してもいい/)) {
    Object.assign(out, {
      conversation_purpose: 'boundary_sensitive',
      emotional_state: 'uncertain',
      user_need: 'boundary',
      reply_depth: 'normal',
      feature_plan: ['none'],
      data_extraction_targets: uniq([...targets, 'emotion']),
      praise_target: 'question',
      praise_intensity: 'light',
      anticipatory_support_needed: false,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'permission_to_talk_boundary',
    });
    return out;
  }

  if (hasAny(text, /何もできません|できなかった|動けなかった/)) {
    Object.assign(out, {
      conversation_purpose: 'shame_or_guilt',
      emotional_state: 'guilty',
      user_need: 'reassure',
      reply_depth: 'normal',
      feature_plan: ['life_context'],
      data_extraction_targets: uniq([...targets, 'emotion', 'life_context']),
      praise_target: 'safety_report',
      praise_intensity: 'light',
      anticipatory_support_needed: true,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'guilt_or_no_action_report',
    });
    return out;
  }

  if (hasAny(text, /仕事で嫌|嫌なこと|腹が立|イライラ|むかつ/)) {
    Object.assign(out, {
      conversation_purpose: 'anger_or_frustration',
      emotional_state: 'frustrated',
      user_need: 'listen',
      reply_depth: 'deep',
      feature_plan: ['life_context'],
      data_extraction_targets: uniq([...targets, 'life_context', 'emotion']),
      praise_target: 'question',
      praise_intensity: 'light',
      anticipatory_support_needed: false,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'work_or_frustration_support',
    });
    return out;
  }

  if (hasAny(text, /疲れ|つかれ|しんど|寂しい|さみしい|不安|つらい|泣きたい/)) {
    Object.assign(out, {
      conversation_purpose: hasAny(text, /寂しい|さみしい|つらい|しんど/) ? 'emotional_support' : 'listen_only',
      emotional_state: hasAny(text, /寂しい|さみしい/) ? 'lonely' : (hasAny(text, /不安/) ? 'anxious' : 'tired'),
      user_need: 'listen',
      reply_depth: hasAny(text, /寂しい|さみしい|つらい|しんど/) ? 'deep' : 'normal',
      feature_plan: ['none'],
      data_extraction_targets: uniq([...targets, 'emotion', 'life_context']),
      praise_target: null,
      praise_intensity: 'none',
      anticipatory_support_needed: false,
      safety_level: 'normal',
      max_questions: 1,
      reason: 'general_emotional_or_tired_text',
    });
    return out;
  }

  out.reason = 'conversation_core_daily_chat';
  return out;
}

module.exports = {
  analyzeConversation,
};
