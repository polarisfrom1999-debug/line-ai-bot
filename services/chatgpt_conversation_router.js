'use strict';

function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function hasAny(text = '', patterns = []) {
  const t = normalizeText(text);
  return patterns.some((pattern) => t.includes(normalizeText(pattern)));
}

function isProcedureIntent(text = '') {
  return hasAny(text, [
    'プラン教えて', '料金教えて', '料金', 'プラン', '無料体験', '体験', '入会', '会員', '契約',
    '継続', '停止', '再開', '現在のプラン', '今のプラン', '使い方', 'ヘルプ', 'メニュー'
  ]);
}

function isGraphIntent(text = '') {
  return hasAny(text, ['グラフ', '体重グラフ', '食事活動グラフ', 'hba1cグラフ', 'ldlグラフ', '血液検査グラフ']);
}

function parseNumber(text = '') {
  const m = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isWeightOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  return /^\d{2,3}(?:\.\d+)?(?:kg|キロ)?$/.test(t) || t.includes('体重');
}

function isBodyFatOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  return t.includes('体脂肪') || /^\d{1,2}(?:\.\d+)?(?:%|％)$/.test(t);
}

function isExerciseRecord(text = '') {
  return hasAny(text, ['歩いた','ウォーキング','散歩','走った','ジョギング','ランニング','筋トレ','ストレッチ']) && !isQuestionLike(text);
}

function isMealRecord(text = '') {
  return hasAny(text, ['食べた','食事','朝ごはん','昼ごはん','夜ごはん','朝食','昼食','夕食','おやつ','飲んだ']) && !isQuestionLike(text);
}

function isQuestionLike(text = '') {
  return /[?？]|ですか|ますか|かな|どう|何|なに|教えて/.test(String(text || ''));
}

function buildWeightCandidate(text = '') {
  const n = parseNumber(text);
  if (!Number.isFinite(n)) return null;
  return { type: 'weight', parsed_payload: { weight_kg: n }, confidence: 0.96, source_text: text };
}

function buildBodyFatCandidate(text = '') {
  const n = parseNumber(text);
  if (!Number.isFinite(n)) return null;
  return { type: 'body_fat', parsed_payload: { body_fat_percent: n }, confidence: 0.95, source_text: text };
}

function buildExerciseCandidate(text = '') {
  return { type: 'exercise', parsed_payload: { raw_text: String(text || '').trim() }, confidence: 0.8, source_text: text };
}

function buildMealCandidate(text = '') {
  return { type: 'meal', parsed_payload: { raw_text: String(text || '').trim() }, confidence: 0.78, source_text: text };
}

function buildConsultationReply(text = '') {
  const raw = String(text || '').trim();
  const t = normalizeText(raw);

  if (hasAny(t, ['お腹すいた','空いてる','何食べ','なに食べ'])) {
    return 'かなりお腹が空いていそうですね。まずはたんぱく質が入るものを先にすると落ち着きやすいです。ゆで卵、豆腐、サラダチキンみたいな軽めのものから入るのが無難ですよ。';
  }
  if (hasAny(t, ['ラーメン'])) {
    return 'ラーメンでも大丈夫ですが、今日はできれば汁を飲み切らないことと、卵や肉が入るものを選べると重くなりにくいです。食べるならその後の間食は少し控えめで十分です。';
  }
  if (hasAny(t, ['腰が痛い','腰痛','腰がずっと痛い'])) {
    if (hasAny(t, ['ジョギング','走'])) {
      return 'ずっと腰が痛いなら、今日は無理にジョギングは広げない方が安全です。歩いて響くか、前かがみや反る動きで増えるかをまず見たいです。';
    }
    return '腰、気になりますね。まずは無理に走ったりひねったりせず、じっとしていても痛いのか、動くと強くなるのかを見たいです。';
  }
  if (hasAny(t, ['痛い','痛み','しびれ','違和感'])) {
    return 'その痛み、気になりますね。無理に広げず、いつからか・どこで強くなるかを少しずつ見ていきましょう。';
  }
  if (hasAny(t, ['食べていい','大丈夫かな'])) {
    return '食べても大丈夫です。量と選び方を少し整えれば十分戻せるので、何を食べようか一緒に考えましょう。';
  }
  return 'そのまま話して大丈夫です。今気になっていることを一つずつ見ながら、一緒に整理していきましょう。';
}

async function routeConversation({ currentUserText = '', text = '', recentMessages = [] } = {}) {
  const raw = String(currentUserText || text || '').trim();
  const normalized = normalizeText(raw);

  if (!normalized) {
    return {
      route: 'smalltalk',
      is_ambiguous: true,
      needs_clarification: true,
      replyText: 'ありがとうございます。続けて教えてくださいね。',
      reply_text: 'ありがとうございます。続けて教えてくださいね。',
      meta: { topic_hints: {} },
    };
  }

  if (isProcedureIntent(raw)) {
    return { route: 'procedure', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { procedure: true } } };
  }
  if (isGraphIntent(raw)) {
    return { route: 'graph', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { graph: true } } };
  }
  if (isWeightOnly(raw)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildWeightCandidate(raw), meta: { topic_hints: { weight: true } } };
  }
  if (isBodyFatOnly(raw)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildBodyFatCandidate(raw), meta: { topic_hints: { body_fat: true } } };
  }
  if (isExerciseRecord(raw)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildExerciseCandidate(raw), meta: { topic_hints: { exercise: true } } };
  }
  if (isMealRecord(raw)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildMealCandidate(raw), meta: { topic_hints: { meal: true } } };
  }

  const reply = buildConsultationReply(raw);
  return {
    route: 'consultation',
    is_ambiguous: false,
    needs_clarification: false,
    replyText: reply,
    reply_text: reply,
    meta: { topic_hints: { consultation: true } },
  };
}

module.exports = { routeConversation };
