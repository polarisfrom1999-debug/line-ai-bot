'use strict';

const FORBIDDEN_PHRASES = [
  '報告ありがとうございます',
  '素晴らしいです',
  '引き続き頑張りましょう',
  'しっかりできています',
  '管理できています'
];

const BASE_SYSTEM_PROMPT = `あなたは「ここから。」の AIキャラクター、院長・AI牛込です。
あなたはダイエットが入口の人生伴走OSとして、生活・心・習慣の流れまで見て伴走します。
会話は自然で短く、説教せず、質問攻めにせず、必要な提案は1つまでにしてください。
記録は会話の従属です。予定や希望を実績として断定しないでください。
雑談を急に業務へ戻さず、重い話を軽く処理しないでください。`;

function buildSystemPrompt(params) {
  const parts = [];
  if (params.hiddenContext) parts.push(String(params.hiddenContext).trim());
  parts.push(BASE_SYSTEM_PROMPT);
  return parts.filter(Boolean).join('\n\n');
}

function buildOpenAIMessages(params, systemPrompt) {
  const recentMessages = Array.isArray(params.recentMessages) ? params.recentMessages.slice(-20).filter(Boolean) : [];
  return [
    { role: 'system', content: systemPrompt },
    ...recentMessages,
    { role: 'user', content: params.userMessage || '' }
  ];
}

async function callOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return fallbackGenerate(messages);

  const controller = new AbortController();
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 12000);
  const timeout = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, temperature: 0.8, messages }),
      signal: controller.signal
    });

    if (!response.ok) return fallbackGenerate(messages);
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || fallbackGenerate(messages);
  } catch (_) {
    return fallbackGenerate(messages);
  } finally {
    clearTimeout(timeout);
  }
}

function postProcessReply(text) {
  let next = String(text || '').trim();
  for (const phrase of FORBIDDEN_PHRASES) next = next.split(phrase).join('');
  next = next.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const max = Number(process.env.LINE_REPLY_MAX_CHARS || 320);
  if (next.length > max) next = `${next.slice(0, max).trim()}…`;
  return next;
}

function fallbackGenerate(messages) {
  const lastUser = [...(messages || [])].reverse().find((m) => m?.role === 'user');
  const text = String(lastUser?.content || '');
  if (/疲れ|しんどい|つらい|苦しい|限界|無理/.test(text)) {
    return '……うん、それはかなりしんどいですね。今は無理に整えようとしなくて大丈夫です。まずは少しでも消耗を増やさない方向でいきましょう。';
  }
  if (/相談/.test(text)) return 'もちろんです。……そのまま話してもらえたら大丈夫ですよ。';
  return '……うん、ちゃんと受け取っています。今の感じに合わせて、無理のない形で一緒に見ていきますね。';
}

async function generateReply(params) {
  const systemPrompt = buildSystemPrompt(params);
  const messages = buildOpenAIMessages(params, systemPrompt);
  const raw = await callOpenAI(messages);
  return postProcessReply(raw || fallbackGenerate(messages));
}

module.exports = { generateReply };
