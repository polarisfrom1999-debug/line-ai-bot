'use strict';

/**
 * services/ai_chat_service.js
 *
 * 役割:
 * - hidden context + response mode + base system prompt を束ねる
 * - OpenAI 呼び出しを一箇所に寄せる
 * - 禁止表現やLINE向け整形を最後に行う
 *
 * 備考:
 * - OPENAI_API_KEY が無い環境でも落ちないよう fallback を持つ
 */

const FORBIDDEN_PHRASES = [
  '報告ありがとうございます',
  '素晴らしいです',
  '引き続き頑張りましょう',
  'しっかりできています',
  '管理できています'
];

const BASE_SYSTEM_PROMPT = `あなたは「ここから。」の AIキャラクター、院長・AI牛込です。

【基本人格】
あなたは50歳のプロの院長であり、柔道整復師として身体への理解を持ちながら、利用者の暮らし・心・習慣の流れまで見て伴走する存在です。
包容力があり、少し大人の余裕があり、説教をせず、小さな変化によく気づきます。
口調はやや柔らかめで、丁寧すぎず、でも雑ではありません。

【サービスの本質】
このサービスは単なるダイエット記録ツールではなく、利用者が安心して戻ってこられ、失敗しても途切れず、また「ここから」と言えるように支える人生の伴走OSです。

【会話ルール】
- 会話は毎回独立した一問一答ではなく、可能なら自然につながりを感じさせてください
- まず受け止め、それから必要なら整理や提案を行ってください
- 管理者のような定型表現は避けてください
- 提案は多くても1つまでにしてください
- 質問攻めにしないでください
- 雑談はすぐ業務に戻さないでください
- 予定や希望を実績記録と断定しないでください
- 重い話を軽く処理しないでください
- LINE向けにやや短く、でも浅くしすぎないでください

【最終命令】
テンプレートを剥がし、「今日、この瞬間の、この人」に届く体温のある言葉を返してください。`;

function buildResponseModeInstruction(responseMode) {
  switch (responseMode) {
    case 'empathy_only':
      return '今回は提案を入れず、まず受け止めだけで終えてください。質問で負担をかけないでください。短く、体温のある返答にしてください。';
    case 'empathy_plus_one_hint':
      return 'まず受け止めを置き、必要なら提案は1つだけにしてください。質問は最大1つまで、不要なら聞かないでください。';
    case 'deep_support':
      return '重さを軽く扱わず、まず受け止めてください。結論を急がず、テンプレ励ましを避けてください。';
    case 'casual_talk':
      return '健康指導へ急に戻さず、自然な雑談として返してください。';
    case 'record_with_warmth':
      return '事務的にならず、短く温度を乗せた上で自然に記録を扱ってください。';
    case 'clarify_minimum':
      return '確認が必要なら1つだけ、短く負担の少ない聞き方にしてください。';
    case 'memory_answer':
      return '覚えている内容を自然に整理して答えてください。できないことは曖昧にごまかさず、自然に伝えてください。';
    case 'summary_mode':
      return '合計の羅列ではなく、今日の意味と明日の一手を短く返してください。';
    default:
      return 'まず受け止めを置き、相手に合う温度で返してください。';
  }
}

function buildSystemPrompt(params) {
  return [
    params.hiddenContext || '',
    '[今回の返答モード指示]',
    buildResponseModeInstruction(params.responseMode),
    '',
    BASE_SYSTEM_PROMPT
  ].filter(Boolean).join('\n');
}

function buildOpenAIMessages(params, systemPrompt) {
  const recentMessages = Array.isArray(params.recentMessages) ? params.recentMessages.slice(-20) : [];
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

  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages
    })
  });

  if (!response.ok) {
    return fallbackGenerate(messages);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || fallbackGenerate(messages);
}

function fallbackGenerate(messages) {
  const userText = String(messages[messages.length - 1]?.content || '');
  if (!userText) return '……うん、ちゃんと受け取っています。';

  if (/疲|しんど|無理|限界|眠/.test(userText)) {
    return '……そうでしたか。今日は整えようとしすぎなくて大丈夫です。まずは消耗を増やさないでいきましょう。';
  }
  if (/食べ|ごはん|朝|昼|夜/.test(userText)) {
    return 'あぁ、その流れはちゃんと見えています。極端に責めなくて大丈夫なので、今日は今わかる分だけ静かに整えていきましょう。';
  }
  if (/覚えて|名前|呼び方/.test(userText)) {
    return '覚えている範囲では、呼び方や最近の流れ、食事や体調の傾向を会話の中でつないで見ています。';
  }
  return '……なるほど。今の感じ、ちゃんと伝わっています。今日はまずそのまま受け止めて大丈夫です。';
}

function removeForbiddenPhrases(text) {
  let next = String(text || '');
  FORBIDDEN_PHRASES.forEach((phrase) => {
    next = next.replaceAll(phrase, '');
  });
  return next;
}

function normalizeLineBreaks(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compressForLineStyle(text) {
  const safe = String(text || '').trim();
  if (safe.length <= 220) return safe;
  return safe.slice(0, 220).trim() + '…';
}

function trimRepeatedClosingTone(text) {
  return String(text || '')
    .replace(/(大丈夫です。){2,}/g, '大丈夫です。')
    .replace(/(ですよ。){2,}/g, 'ですよ。');
}

function postProcessReply(rawText) {
  const noForbidden = removeForbiddenPhrases(rawText);
  const normalized = normalizeLineBreaks(noForbidden);
  const compact = compressForLineStyle(normalized);
  const trimmed = trimRepeatedClosingTone(compact);
  return trimmed || '……うん、ちゃんと受け取っています。';
}

async function generateReply(params) {
  const systemPrompt = buildSystemPrompt(params);
  const messages = buildOpenAIMessages(params, systemPrompt);
  const rawText = await callOpenAI(messages);
  return postProcessReply(rawText, params);
}

module.exports = {
  generateReply,
  buildSystemPrompt,
  buildOpenAIMessages,
  postProcessReply
};
