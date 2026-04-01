'use strict';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function normalizeText(value) {
  return String(value || '').trim();
}

function postProcessReply(text) {
  const safe = normalizeText(text);
  if (!safe) {
    return 'うん、ちゃんと受け取りました。今の流れに合わせて、一緒に整えていきましょう。';
  }

  return safe
    .replace(/報告ありがとうございます。?/g, '')
    .replace(/引き続き頑張りましょう。?/g, 'また一緒に整えていきましょう。')
    .replace(/素晴らしいです。?/g, 'いい流れですね。')
    .trim();
}

function inferAiStyle(aiType) {
  const safe = normalizeText(aiType);
  if (/頼もしく|導く|理屈|整理/.test(safe)) return 'logic_first';
  if (/そっと|寄り添|やさしく|伴走/.test(safe)) return 'gentle_first';
  if (/明るく|後押し|背中を押す/.test(safe)) return 'push_lightly';
  if (/力強く|支える/.test(safe)) return 'balanced';
  return 'balanced';
}

function buildSystemPrompt(hiddenContext, responseMode, longMemory) {
  const aiStyle = inferAiStyle(longMemory?.aiType);
  const preferredName = normalizeText(longMemory?.preferredName || '');

  return [
    'あなたは「ここから。」の AI牛込 です。',
    '単なる記録AIではなく、人生の伴走OSとして振る舞ってください。',
    '口調はやや柔らかく、説教しません。丁寧すぎず、少し大人の余裕があります。',
    '会話はLINE向けで、1〜5文程度を基本にします。',
    '会話の順番は「受け止める→必要なら整理→提案は1つまで」です。',
    '質問攻めにしないでください。質問は本当に必要な時だけ1つまでです。',
    '雑談や相談はすぐ記録モードに戻しすぎないでください。',
    'しんどさ・痛み・不安がある時は、改善提案より先に負担を増やさない方向を優先してください。',
    '「報告ありがとうございます」「素晴らしいです」「引き続き頑張りましょう」は使わないでください。',
    preferredName ? `ユーザーの呼び方の候補: ${preferredName}` : null,
    `AIスタイル: ${aiStyle}`,
    `responseMode: ${responseMode || 'empathy_plus_one_hint'}`,
    hiddenContext ? hiddenContext : ''
  ].filter(Boolean).join('\n');
}

function convertRecentMessages(recentMessages) {
  const messages = Array.isArray(recentMessages) ? recentMessages : [];
  return messages
    .slice(-12)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: normalizeText(m.content)
    }))
    .filter((m) => m.content);
}

function fallbackGenerate(params) {
  const text = normalizeText(params?.userMessage || '');
  const stateFlags = Array.isArray(params?.stateFlags) ? params.stateFlags : [];

  if (stateFlags.includes('safety_attention') || /心が苦しい|消えたい|激痛|骨折/.test(text)) {
    return 'それはかなり優先度の高いしんどさですね。今は整えることより安全を先にして、無理を増やさない動きで考えましょう。';
  }

  if (stateFlags.includes('pain') || /痛い|つらい|しんどい|苦しい/.test(text)) {
    return 'うーん、それはしんどかったですね。今は無理に整えようとしすぎず、まず負担を増やさない方向で見ていきましょう。';
  }

  if (stateFlags.includes('fatigue') || /疲れ|眠い|寝不足|だるい/.test(text)) {
    return 'なるほど。今日は頑張って整えるというより、消耗を増やしすぎない方が大事そうですね。';
  }

  if (/走った|ジョギング|スクワット|運動/.test(text)) {
    return 'ちゃんと動けていますね。量の大小より、続けて体を動かせている流れに意味があります。';
  }

  if (/食べた|朝ごはん|昼ごはん|夜ごはん|ラーメン|寿司|カレー/.test(text)) {
    return 'うん、食事の流れはちゃんと受け取れています。責めるより、次にどう整えやすいかを一緒に見ていきましょう。';
  }

  if (/ありがとう|助かった/.test(text)) {
    return 'そう言ってもらえてよかったです。またその時々で一緒に見ていきましょう。';
  }

  if (!text) {
    return 'うん、ちゃんと受け取れています。今の流れに合わせて、一緒に整えていきましょう。';
  }

  return 'なるほど。今の感じはちゃんと受け取れています。無理に急がず、今のあなたに合う形で一緒に見ていきましょう。';
}

async function callOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') {
    return '';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(OPENAI_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[ai_chat_service] openai error:', text || response.status);
      return '';
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('[ai_chat_service] callOpenAI error:', error?.message || error);
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function generateReply(params) {
  const systemPrompt = buildSystemPrompt(params?.hiddenContext, params?.responseMode, params?.longMemory || {});
  const recent = convertRecentMessages(params?.recentMessages);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent,
    { role: 'user', content: normalizeText(params?.userMessage || '') }
  ];

  const raw = await callOpenAI(messages);
  if (!normalizeText(raw)) {
    return fallbackGenerate(params);
  }

  return postProcessReply(raw);
}

module.exports = {
  generateReply,
  inferAiStyle
};
