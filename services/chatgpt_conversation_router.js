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

function parseNumber(text = '') {
  const m = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function isQuestionLike(text = '') {
  return /[?？]|ですか|ますか|かな|どう|何|なに|教えて/.test(String(text || ''));
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

function isWeightOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  return /^\d{2,3}(?:\.\d+)?(?:kg|キロ)?$/.test(t) || /体重\d/.test(t);
}

function isBodyFatOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  return t.includes('体脂肪') || /^\d{1,2}(?:\.\d+)?(?:%|％)$/.test(t);
}

function isExerciseRecord(text = '') {
  return hasAny(text, ['歩いた', 'ウォーキング', '散歩', '走った', 'ジョギング', 'ランニング', '筋トレ', 'ストレッチ']) && !isQuestionLike(text);
}

function isMealRecord(text = '') {
  return hasAny(text, ['食べた', '食事', '朝ごはん', '昼ごはん', '夜ごはん', '朝食', '昼食', '夕食', 'おやつ', '飲んだ']) && !isQuestionLike(text);
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

function isProfileEditIntent(text = '') {
  return hasAny(text, ['プロフィール変更', 'プロフィール修正', 'プロフィール更新', '設定変更']);
}

function isMemoryQuestion(text = '') {
  return hasAny(text, ['名前覚えてる', '私の名前覚えてる', '前に何て言った', '前に何言った', '覚えてる?', '覚えてる？']);
}

function isImageFollowupMeal(text = '') {
  return hasAny(text, ['食事の写真です', 'ごはんの写真です', '料理の写真です', 'この写真です']);
}

function isImageFollowupLab(text = '') {
  return hasAny(text, ['血液検査です', '検査結果です', '採血結果です']);
}

function isConsultStarter(text = '') {
  return hasAny(text, ['相談したい', '少し相談', '聞いてほしい']);
}

function buildMemoryReply(text = '', context = {}) {
  const name = String(context?.display_name || '').trim();
  if (hasAny(text, ['名前覚えてる', '私の名前覚えてる'])) {
    if (name) {
      return `${name}さんとして見ています。呼び方を変えたい時は、そのまま教えてくださいね。`;
    }
    return 'まだ呼び方ははっきり受け取れていません。呼んでほしい名前があれば、そのまま送ってくださいね。';
  }
  return '前のお話は全部をそのまま返す形ではないですが、今後の伴走に必要そうなことは少しずつ踏まえて見ています。気になる点があれば、そのまま言ってくださいね。';
}

function buildConsultationReply(text = '', context = {}) {
  const raw = String(text || '').trim();
  const t = normalizeText(raw);

  if (isImageFollowupMeal(raw)) {
    return 'ありがとうございます。食事の写真として見ていきます。写真だけでも大丈夫ですし、補足があれば一言だけ続けてください。';
  }
  if (isImageFollowupLab(raw)) {
    return 'ありがとうございます。血液検査として整理していきます。数値が見づらい所があれば、あとで必要な所だけ確認しますね。';
  }
  if (isConsultStarter(raw)) {
    return 'もちろん大丈夫です。今いちばん気になっていることから、そのまま話してくださいね。';
  }
  if (isMemoryQuestion(raw)) {
    return buildMemoryReply(raw, context);
  }
  if (isProfileEditIntent(raw)) {
    return 'プロフィール変更ですね。変えたい項目をそのまま送ってください。';
  }
  if (hasAny(t, ['頭痛', '頭が痛い', '頭いたい'])) {
    return '頭痛つらいですね。今は無理に動かず、水分が取れそうなら少しだけでも大丈夫です。いつからか、ズキズキか重い感じかだけでも分かると見やすいです。';
  }
  if (hasAny(t, ['お腹すいた', 'お腹空いた', '空腹'])) {
    return 'お腹すいたんですね。まずはたんぱく質が入る軽めのものを先に入れると落ち着きやすいです。ゆで卵、豆腐、味噌汁あたりからでも十分です。';
  }
  if (hasAny(t, ['何食べ', 'なに食べ', '夜ご飯', '夜ごはん'])) {
    return '今の時間なら、重すぎないものが安心です。たんぱく質と温かいものを先にすると整えやすいので、魚、豆腐、卵、汁物あたりが無難ですよ。';
  }
  if (hasAny(t, ['ラーメン'])) {
    return 'ラーメンでも大丈夫です。食べるなら、今日は汁を飲み切らないことと、卵や肉が入るものを選べると重くなりにくいです。';
  }
  if (hasAny(t, ['膝が痛い', '膝痛', '膝いたい'])) {
    return '膝、気になりますね。歩くこと自体は様子を見ながらでもいいことがありますが、歩くたびに強くなるなら今日は広げすぎない方が安心です。平地で少し試して響くかを見たいです。';
  }
  if (hasAny(t, ['腰が痛い', '腰痛', '腰がずっと痛い'])) {
    return '腰、気になりますね。今日は無理にひねったり走ったりは広げず、じっとしていても痛いのか、動くと強くなるのかをまず見たいです。';
  }
  if (hasAny(t, ['痛い', '痛み', 'しびれ', '違和感'])) {
    return 'その痛み、気になりますね。無理に広げず、いつからか・どこで強くなるかを少しずつ見ていきましょう。';
  }
  if (hasAny(t, ['不安', 'しんどい', 'つらい', '落ちる'])) {
    return 'その感じ、ひとりで抱えるとしんどいですよね。今いちばん引っかかっていることからで大丈夫なので、そのまま話してください。';
  }
  if (hasAny(t, ['食べていい', '大丈夫かな'])) {
    return '大丈夫です。量と選び方を少し整えれば戻しやすいので、何を食べようか一緒に考えましょう。';
  }
  return '今気になっていることを、そのまま一つだけでも大丈夫です。いっしょに見ていきましょう。';
}

async function routeConversation({ currentUserText = '', text = '', recentMessages = [], context = {} } = {}) {
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

  if (isMemoryQuestion(raw)) {
    const reply = buildMemoryReply(raw, context);
    return { route: 'consultation', is_ambiguous: false, needs_clarification: false, replyText: reply, reply_text: reply, meta: { topic_hints: { memory: true } } };
  }

  if (isProfileEditIntent(raw)) {
    const reply = 'プロフィール変更ですね。変えたい項目をそのまま送ってください。';
    return { route: 'consultation', is_ambiguous: false, needs_clarification: false, replyText: reply, reply_text: reply, meta: { topic_hints: { profile_edit: true } } };
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

  const reply = buildConsultationReply(raw, context);
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
