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
  return hasAny(text, [
    'グラフ', '体重グラフ', '体重推移', '体重の流れ', '食事活動グラフ', 'hba1cグラフ', 'ldlグラフ', '血液検査グラフ',
    'hba1cを見たい', 'ldlを見たい', 'hba1c見たい', 'ldl見たい', '血液検査を見たい', 'hba1c', 'ldl'
  ]);
}

function isQuestionLike(text = '') {
  return /[?？]|ですか|ますか|かな|どう|何|なに|教えて|見たい/.test(String(text || ''));
}

function buildConsultationReply(text = '', context = {}) {
  const raw = String(text || '').trim();
  const t = normalizeText(raw);
  const displayName = String(context?.display_name || '').trim();
  const currentWeight = Number(context?.weight_kg);

  if (hasAny(t, ['私の名前覚えてる', '名前覚えてる', '名前わかる'])) {
    return displayName
      ? `${displayName}さんとして見ています。呼び方を変えたい時は、そのまま教えてくださいね。`
      : 'お名前はまだこちらでうまく拾えていないので、呼び方があればそのまま教えてくださいね。';
  }

  if (hasAny(t, ['私の体重覚えてる', '体重覚えてる'])) {
    return Number.isFinite(currentWeight)
      ? `今こちらで見えている体重は ${currentWeight}kg です。違っていたら、そのまま新しい数字を送ってくださいね。`
      : '体重はまだこちらで確定できていないので、今の数字をそのまま送ってもらえれば大丈夫です。';
  }

  if (hasAny(t, ['お腹すいた', '空いてる', '何食べ', 'なに食べ'])) {
    return 'かなりお腹が空いていそうですね。まずはたんぱく質が入るものを先にすると落ち着きやすいです。ゆで卵、豆腐、サラダチキンみたいな軽めのものから入るのが無難ですよ。';
  }

  if (hasAny(t, ['ラーメン'])) {
    return 'ラーメンでも大丈夫ですが、今日はできれば汁を飲み切らないことと、卵や肉が入るものを選べると重くなりにくいです。食べるならその後の間食は少し控えめで十分です。';
  }

  if (hasAny(t, ['痺れ', 'しびれ', '痺れてる'])) {
    return 'しびれは少し丁寧に見たいです。今日は無理に広げず、じっとしていてもあるのか、動いた時に強くなるのかをまず見たいです。力が入りにくい・範囲が広がる感じがあれば早めに相談してくださいね。';
  }

  if (hasAny(t, ['肩']) && hasAny(t, ['腕立て', '伏せ'])) {
    return '肩が痛い中で腕立て伏せは、今日は無理に広げない方が安全です。上げる動きで痛むのか、前から痛いのかを見ながら、まずは負荷の低い動きにしておきましょう。';
  }

  if ((hasAny(t, ['足', '脚', '膝']) || hasAny(t, ['スクワット'])) && hasAny(t, ['スクワット'])) {
    return '足が痛い状態なら、今日はスクワットは無理に広げない方がよさそうです。しゃがむ途中で強くなるのか、立ち上がりで響くのかをまず見たいです。';
  }

  if (hasAny(t, ['膝']) && hasAny(t, ['歩いていい', '歩いて良い', '歩いて'])) {
    return '膝ですね。平らな所を少し歩く程度で痛みが増えないなら様子見はできますが、今日は距離を伸ばしすぎない方が安全です。歩いて強くなるなら早めに止めましょう。';
  }

  if (hasAny(t, ['腰が痛い', '腰痛', '腰'])) {
    if (hasAny(t, ['ジョギング', '走'])) {
      return '腰が痛い中で走るのは、今日は無理に広げない方が安全です。歩いて響くか、前かがみや反る動きで増えるかをまず見たいです。';
    }
    return '腰、気になりますね。今日は無理にひねったり走ったりは広げず、じっとしていても痛いのか、動くと強くなるのかをまず見たいです。';
  }

  if (hasAny(t, ['頭痛', '頭痛い'])) {
    return '頭痛はつらいですね。まずは水分や休みやすさを見ながら、いつもより強いか、長引いているかを見たいです。強い痛みやいつもと違う感じがあれば無理せず相談してくださいね。';
  }

  if (hasAny(t, ['痛い', '痛み', '違和感'])) {
    return 'その痛み、気になりますね。無理に広げず、いつからか・どこで強くなるかを少しずつ見ていきましょう。';
  }

  if (hasAny(t, ['不安', 'つらい', 'しんどい'])) {
    return 'それはしんどいですね。今は全部まとめなくて大丈夫なので、いちばん気になることから一つずつ見ていきましょう。';
  }

  if (hasAny(t, ['食べていい', '大丈夫かな'])) {
    return '食べても大丈夫です。量と選び方を少し整えれば十分戻せるので、何を食べようか一緒に考えましょう。';
  }

  return '話してくれてありがとうございます。今いちばん気になるところから、一緒に見ていきましょう。';
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

  if (isProcedureIntent(raw)) {
    return { route: 'procedure', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { procedure: true } } };
  }
  if (isGraphIntent(raw)) {
    return { route: 'graph', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { graph: true } } };
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
