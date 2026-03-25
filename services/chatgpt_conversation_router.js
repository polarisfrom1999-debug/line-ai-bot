'use strict';

function normalize(text = '') {
  return String(text || '').trim();
}

function routeConversation({ currentUserText = '', context = {} } = {}) {
  const raw = normalize(currentUserText);
  const t = raw.replace(/[　\s]+/g, '');

  if (!raw) return { route: 'smalltalk', replyText: 'ありがとうございます。続けて教えてくださいね。' };
  if (/今何時/.test(raw)) return { route: 'time' };
  if (/あなたの名前|君の名前|AIの名前/.test(raw)) return { route: 'assistant_name', replyText: '私はAI牛込として寄り添います。' };
  if (/私の名前|名前覚えて/.test(raw)) return { route: 'user_name' };
  if (/私の体重|今の体重/.test(raw)) return { route: 'user_weight' };
  if (/毎日毎日心が苦しい|心が苦しい|つらい|しんどい/.test(raw)) return { route: 'support', replyText: 'それはかなりしんどいですね。今は一人で抱え込みすぎず、今日いちばん苦しい時間帯や、少しでも楽になる瞬間があるかを一緒に見たいです。強い不安や眠れない感じが続くなら、身近な人や医療機関にも早めに頼ってくださいね。' };
  if (/どうやったら緩む|どうすれば緩む/.test(raw)) return { route: 'support', replyText: '腰や肩の硬さなら、今日は強く伸ばすより、温めてから小さく動かす方が無難です。痛みに変わるなら止めて、呼吸をゆっくりにして力が抜けるかを見たいです。' };
  if (/腰が硬い/.test(raw)) return { route: 'support', replyText: '腰が硬い感じなんですね。今日は反動をつけず、温めてから骨盤を小さく前後に動かすくらいからが無難です。痛みに変わるなら無理せず止めましょう。' };
  if (/右脚が痺れて|しびれて/.test(raw)) return { route: 'support', replyText: 'しびれは気になりますね。今日は無理に頑張るより、どこまで広がるか、力が入りにくい感じがあるかをまず見たいです。強くなるなら無理せず早めに相談しましょう。' };
  if (/肩が痛い.*腕立て/.test(raw)) return { route: 'support', replyText: '肩が痛いなら、今日は腕立て伏せは広げない方が安全です。腕を上げる時や後ろに回す時に強くなるかを見ながら、まずは休ませたいです。' };
  if (/足.*スクワット/.test(raw) || /膝.*スクワット/.test(raw)) return { route: 'support', replyText: '足や膝が痛い時のスクワットは、今日は無理に増やさない方がよさそうです。しゃがむ途中で痛むのか、立つ時に痛むのかを先に見たいです。' };
  if (/腰が痛い/.test(raw)) return { route: 'support', replyText: '腰、気になりますね。まずは無理に走ったりひねったりせず、じっとしていても痛いのか、動くと強くなるのかを見たいです。' };
  return { route: 'consultation', replyText: '' };
}

module.exports = { routeConversation };
