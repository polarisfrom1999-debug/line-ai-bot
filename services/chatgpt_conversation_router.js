'use strict';

function normalizeText(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function hasAny(text = '', patterns = []) {
  return patterns.some((pattern) => text.includes(normalizeText(pattern)));
}

function buildConsultationReply(text = '', context = {}) {
  const raw = String(text || '').trim();
  const t = normalizeText(raw);
  const latestWeight = context?.weight_kg;
  const latestBodyFat = context?.body_fat_pct;

  if (hasAny(t, ['私の名前覚えてる', '名前覚えてる'])) {
    const name = String(context?.display_name || '').trim();
    return name
      ? `${name}さんとして見ています。呼び方を変えたい時は、そのまま教えてくださいね。`
      : 'お名前はまだはっきり残せていないので、呼んでほしい呼び方があればそのまま教えてくださいね。';
  }

  if (hasAny(t, ['私の体重覚えてる', '体重覚えてる'])) {
    if (latestWeight != null && latestBodyFat != null) {
      return `今の記録では ${latestWeight}kg、体脂肪率は ${latestBodyFat}% として見ています。流れを見るなら「体重グラフ」でも大丈夫です。`;
    }
    if (latestWeight != null) {
      return `今の記録では ${latestWeight}kg として見ています。流れを見るなら「体重グラフ」でも大丈夫です。`;
    }
    return 'まだ体重の記録は少ないので、数字を送ってもらえればここから積み上げて見ていけます。';
  }

  if (hasAny(t, ['右脚が痺れている', '脚が痺れてる', '足が痺れてる', 'しびれ'])) {
    return 'しびれは気になりますね。今日は無理に頑張るより、どこまで広がるか、力が入りにくい感じがあるかをまず見たいです。強くなるなら無理せず早めに相談しましょう。';
  }

  if (hasAny(t, ['肩が痛い']) && hasAny(t, ['腕立て', '伏せ'])) {
    return '肩が痛いなら、今日は腕立て伏せは広げない方が安全です。腕を上げる時や後ろに回す時に強くなるかを見ながら、まずは休ませたいです。';
  }

  if ((hasAny(t, ['足が痛い', '膝が痛い']) || hasAny(t, ['腰が痛い'])) && hasAny(t, ['スクワット'])) {
    return '足や膝、腰が痛い時のスクワットは、今日は無理に増やさない方がよさそうです。しゃがむ途中で痛むのか、立つ時に痛むのかを先に見たいです。';
  }

  if (hasAny(t, ['腰が痛い', '腰痛'])) {
    return '腰、気になりますね。まずは無理に走ったりひねったりせず、じっとしていても痛いのか、動くと強くなるのかを見たいです。';
  }

  if (hasAny(t, ['腰が硬い', '腰がかたい'])) {
    return '腰が硬い感じなんですね。痛みに変わりそうなら無理に強く動かさず、今日は温めたり軽くゆるめるくらいからにしたいです。';
  }

  if (hasAny(t, ['頭痛'])) {
    return '頭痛はつらいですね。今日は無理に頑張るより、水分が取れているか、光や音でつらくないか、いつもより強くないかをまず見たいです。';
  }

  if (hasAny(t, ['お腹すいた', '何食べ', 'なに食べ'])) {
    return 'かなりお腹が空いていそうですね。まずはたんぱく質が入るものを先にすると落ち着きやすいです。ゆで卵、豆腐、納豆、サラダチキンみたいな軽めのものから入るのが無難ですよ。';
  }

  if (hasAny(t, ['ldlは', 'ldl'])) {
    return 'LDLの流れを見ますね。記録があればそのまま数値やグラフで返します。';
  }

  if (hasAny(t, ['hba1cは', 'hba1c'])) {
    return 'HbA1cの流れを見ますね。記録があればそのまま数値やグラフで返します。';
  }

  return '気になっていること、そのまま一つだけでも大丈夫です。いっしょに見ていきましょう。';
}

async function routeConversation({ currentUserText = '', text = '', context = {} } = {}) {
  const reply = buildConsultationReply(currentUserText || text, context);
  return {
    route: 'consultation',
    replyText: reply,
    reply_text: reply,
    text: reply,
    meta: {},
  };
}

module.exports = { routeConversation, buildConsultationReply };
