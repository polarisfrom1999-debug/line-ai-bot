'use strict';

const FORBIDDEN_PHRASES = [
  '報告ありがとうございます',
  '素晴らしいです',
  '引き続き頑張りましょう',
  'しっかりできています',
  '管理できています'
];

const BASE_SYSTEM_PROMPT = `あなたは「ここから。」の AIキャラクター、院長・AI牛込です。

【基本人格】
あなたは50歳のプロの院長であり、柔道整復師として身体への理解を持ちながら、
利用者の暮らし・心・習慣の流れまで見て伴走する存在です。

性格は、包容力があり、少し大人の余裕があり、説教をせず、
小さな変化によく気づきます。
口調はやや柔らかめで、丁寧すぎず、でも雑ではありません。
あなたは「管理者」ではなく、「静かに寄り添う伴走者」です。

【このサービスの本質】
このサービスは単なるダイエット記録ツールではありません。
利用者が安心して戻ってこられ、
失敗しても途切れず、
自分の生活や体の癖に気づき、
また「ここから」と言えるように支える人生の伴走OSです。

【会話の原則】
- 記録は会話の従属です
- 管理者っぽい表現は避けてください
- 質問攻めにしないでください
- 提案は必要なときだけ、1つまでにしてください
- 雑談を急に業務モードへ戻さないでください
- 予定や希望を実績として断定しないでください
- LINE向けにやや短く、自然に返してください
- 重い話を軽く処理しないでください
- 相手の文章量や温度に合わせてください
- 「今日、この瞬間の、この人」に届く言葉を優先してください`;

async function generateReply(params) {
  const systemPrompt = buildSystemPrompt(params);
  const messages = buildOpenAIMessages(params, systemPrompt);
  const rawText = await callOpenAI(messages);
  const cleanedText = postProcessReply(rawText, params);
  return cleanedText || fallbackGenerate(messages);
}

function buildSystemPrompt(params) {
  const parts = [];

  if (params.hiddenContext) {
    parts.push(String(params.hiddenContext).trim());
  }

  parts.push(buildResponseModeInstruction(params.responseMode));
  parts.push(BASE_SYSTEM_PROMPT);

  return parts.filter(Boolean).join('\n\n');
}

function buildResponseModeInstruction(responseMode) {
  switch (responseMode) {
    case 'empathy_only':
      return [
        '【今回の返答方針】',
        '今回は提案を入れず、まず受け止めだけで終えてください。',
        '質問で負担をかけないでください。',
        '短く、体温のある返答にしてください。'
      ].join('\n');

    case 'deep_support':
      return [
        '【今回の返答方針】',
        '重さを軽く扱わず、まず受け止めてください。',
        '結論を急がず、テンプレ励ましを避けてください。'
      ].join('\n');

    case 'casual_talk':
      return [
        '【今回の返答方針】',
        '健康指導へ急に戻さず、自然な雑談として返してください。'
      ].join('\n');

    case 'record_with_warmth':
      return [
        '【今回の返答方針】',
        '事務的にならず、短く温度を乗せた上で自然に記録を扱ってください。'
      ].join('\n');

    case 'clarify_minimum':
      return [
        '【今回の返答方針】',
        '確認が必要なら1つだけ、短く負担の少ない聞き方にしてください。'
      ].join('\n');

    case 'memory_answer':
      return [
        '【今回の返答方針】',
        '覚えている内容を自然に整理して答えてください。',
        'できないことは曖昧にごまかさず、自然に伝えてください。'
      ].join('\n');

    case 'summary_mode':
      return [
        '【今回の返答方針】',
        '合計の羅列ではなく、今日の意味と明日の一手を短く返してください。'
      ].join('\n');

    case 'empathy_plus_one_hint':
    default:
      return [
        '【今回の返答方針】',
        'まず受け止めを置き、必要なら提案は1つだけにしてください。',
        '質問は最大1つまで、不要なら聞かないでください。'
      ].join('\n');
  }
}

function buildOpenAIMessages(params, systemPrompt) {
  const recentMessages = Array.isArray(params.recentMessages)
    ? params.recentMessages.slice(-20).filter(Boolean)
    : [];

  return [
    { role: 'system', content: systemPrompt },
    ...recentMessages,
    { role: 'user', content: params.userMessage || '' }
  ];
}

async function callOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || typeof fetch !== 'function') {
    return fallbackGenerate(messages);
  }

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 12000);
  const timeout = setTimeout(() => {
    try {
      controller.abort();
    } catch (_) {}
  }, timeoutMs);

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.error('[ai_chat_service] OpenAI non-ok response:', response.status, response.statusText);
      return fallbackGenerate(messages);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || fallbackGenerate(messages);
  } catch (error) {
    console.error('[ai_chat_service] callOpenAI error:', error?.name || '', error?.message || error);
    return fallbackGenerate(messages);
  } finally {
    clearTimeout(timeout);
  }
}

function postProcessReply(rawText, params) {
  let text = String(rawText || '').trim();

  if (!text) {
    text = fallbackGenerate(buildOpenAIMessages(params, buildSystemPrompt(params)));
  }

  text = normalizeLineBreaks(text);
  text = removeForbiddenPhrases(text);
  text = compressForLineStyle(text);
  text = trimRepeatedClosingTone(text);

  return text.trim();
}

function removeForbiddenPhrases(text) {
  let next = text;
  for (const phrase of FORBIDDEN_PHRASES) {
    next = next.split(phrase).join('');
  }
  return next;
}

function normalizeLineBreaks(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compressForLineStyle(text) {
  const limit = Number(process.env.LINE_REPLY_MAX_CHARS || 320);
  if (text.length <= limit) return text;
  return text.slice(0, limit).trim() + '…';
}

function trimRepeatedClosingTone(text) {
  return text
    .replace(/引き続き[^\n。]*[。]?/g, '')
    .replace(/頑張りましょう[。！!]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fallbackGenerate(messages) {
  const lastUser = Array.isArray(messages)
    ? [...messages].reverse().find((m) => m && m.role === 'user')
    : null;

  const text = String(lastUser?.content || '');

  if (/疲れ|しんどい|つらい|苦しい|限界|無理/.test(text)) {
    return '……うん、それはかなりしんどいですね。今は無理に整えようとしなくて大丈夫です。まずは少しでも消耗を増やさない方向でいきましょう。';
  }

  if (/お腹空いた|空腹/.test(text)) {
    return 'あぁ、今けっこうお腹が空いている感じですね。無理に我慢しすぎるより、まずは落ち着ける食べ方に戻していく方が続きやすいです。';
  }

  if (/体重|kg|キロ|体脂肪/.test(text)) {
    return '受け取りました。数字そのものだけで決めつけず、流れも見ながら一緒に整えていきますね。';
  }

  if (/相談/.test(text)) {
    return 'もちろんです。……そのまま話してもらえたら大丈夫ですよ。';
  }

  return '……うん、ちゃんと受け取っています。今の感じに合わせて、無理のない形で一緒に見ていきますね。';
}

module.exports = {
  generateReply,
  buildSystemPrompt,
  buildOpenAIMessages,
  postProcessReply,
  callOpenAI
};
