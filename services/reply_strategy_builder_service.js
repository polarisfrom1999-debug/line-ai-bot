'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function uniq(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function praiseHint(target, intensity) {
  if (!target || intensity === 'none') return null;
  if (intensity === 'emoji_only') return '👍';
  const light = {
    awareness: 'その気づき、大事です。',
    question: '聞いてくれて良かったです。',
    action: '実際に動けたこと、ちゃんと材料になります。',
    consistency: '続けて見られているのが良いです。',
    correction: '言い直せたのは良い調整です。',
    adjustment: '調整できているのが良いです。',
    rest_decision: '休む判断も調整のうちです。',
    safety_report: '安全に報告できたのは大事です。',
    family_effort: '家族のことを見て相談できているのが良いです。',
    achievement: 'ここまで続けた成果ですね。',
  };
  if (intensity === 'deep') return 'ここまで続けてきたからこそ、自分で判断できる段階に入っています。';
  if (intensity === 'normal' && target === 'achievement') return '目標まで進めたこと、しっかり成果として受け取っていいです。';
  if (intensity === 'normal' && target === 'question') return '買い出し前に確認できたのは、かなり良い進め方です。';
  return light[target] || null;
}

function buildAnticipatorySupport(text, understanding = {}) {
  const t = normalizeText(text);
  const items = [];
  if (/すりごま|きなこ/.test(t)) {
    items.push('量は大さじ1/2くらいから。買うなら粒ごまではなく「すりごま」を選ぶ。');
    items.push('ヨーグルトやアボカドには、白すりごまの方が合わせやすい。');
  }
  if (/作り置き/.test(t)) {
    items.push('味を濃くしすぎず、あとで足せる形にしておく。');
    items.push('家族分と自分の分が混ざるなら、先に取り分ける。');
  }
  if (/コンビニ/.test(t)) {
    items.push('主食・たんぱく質・汁物か水分の3つで選ぶと迷いにくい。');
    items.push('甘い飲み物より、お茶か水を先に取る。');
  }
  if (/旅行|たくさん歩/.test(t)) {
    items.push('靴と休憩ポイントを先に決めておく。');
    items.push('当日は距離より、途中で座れる場所を確保する。');
  }
  if (/薬|シナール|中止|やめ/.test(t)) {
    items.push('自己判断で中止せず、処方元に確認する。');
    items.push('相談時は、飲んでいる量・期間・困っている症状を一緒に伝える。');
  }
  if (/血液検査|検査結果|尿酸|LDL|HDL|中性脂肪|TG|HbA1c/i.test(t)) {
    items.push('単回の良し悪しより、前回との差と検査時期を並べる。');
    items.push('診断は断定せず、気になる項目を医師に確認する前提で整理する。');
  }
  if (/100m|200m|800m|1500m|タイム|ハム|張/.test(t)) {
    items.push('今日は原因探しを1つに絞り、疲労・痛み・睡眠のどれが近いか見る。');
    items.push('違和感が強い時は本数や強度を増やさない。');
  }
  if (understanding.anticipatory_support_needed && !items.length) {
    items.push('次に迷いそうな点だけ、1つに絞って確認する。');
  }
  return uniq(items).slice(0, 2);
}

function buildReplyStrategy(params = {}) {
  const understanding = params.conversationUnderstanding || {};
  const text = normalizeText(params.text || params.userText || '');
  const route = normalizeText(params.route || params.intentType || '');
  const replyDepth = normalizeText(understanding.reply_depth || params.replyDepth || 'normal');
  const safety = normalizeText(understanding.safety_level || 'normal');
  const purpose = normalizeText(understanding.conversation_purpose || '');

  let openingStyle = 'soft';
  if (safety === 'urgent') openingStyle = 'safety_first';
  else if (purpose === 'celebration') openingStyle = 'celebrate';
  else if (/anxious|uncertain|fearful/.test(understanding.emotional_state || '') || replyDepth === 'explain') openingStyle = 'reassure_first';
  else if (purpose === 'health_record') openingStyle = 'direct';

  const praise = {
    target: understanding.praise_target || null,
    intensity: understanding.praise_intensity || 'none',
    text_hint: praiseHint(understanding.praise_target, understanding.praise_intensity || 'none'),
  };

  const featurePlan = Array.isArray(understanding.feature_plan) ? understanding.feature_plan : [];
  const featureResults = params.featureResults && typeof params.featureResults === 'object' ? params.featureResults : {};
  const featureRoute = Boolean(route && !/life_companion|emotional_support|casual_chat|normal_chat/.test(route));

  const strategy = {
    reply_depth: replyDepth,
    opening_style: openingStyle,
    praise,
    anticipatory_support: buildAnticipatorySupport(text, understanding),
    max_questions: Number.isFinite(Number(understanding.max_questions)) ? Number(understanding.max_questions) : 1,
    numeric_blocks_allowed: Boolean(featureResults.saved || featureResults.formattedLines || /meal|lab/.test(route)),
    should_use_feature_result: featureRoute || featurePlan.some((x) => x && x !== 'none'),
    should_keep_health_topic: featurePlan.some((x) => /meal|lab|movement|exercise|body_condition|medication|athlete/.test(x)),
    avoid: uniq([
      '内部用語を出さない',
      '性格を決めつけない',
      '診断断定をしない',
      '薬の中止や変更を指示しない',
      '毎回「無理なく」「大丈夫です」だけで終わらない',
      safety === 'urgent' ? '通常会話として流さない' : '',
    ]),
  };

  console.info('[reply_strategy_built]', {
    user_id: normalizeText(params.userId || ''),
    text: text.slice(0, 120),
    conversation_purpose: understanding.conversation_purpose || '',
    emotional_state: understanding.emotional_state || '',
    user_need: understanding.user_need || '',
    reply_depth: strategy.reply_depth,
    feature_plan: featurePlan,
    data_extraction_targets: understanding.data_extraction_targets || [],
    praise_target: praise.target,
    anticipatory_support_needed: Boolean(understanding.anticipatory_support_needed),
    safety_level: safety || 'normal',
    route,
    reason: understanding.reason || 'reply_strategy_from_understanding',
  });

  return strategy;
}

module.exports = {
  buildReplyStrategy,
};
