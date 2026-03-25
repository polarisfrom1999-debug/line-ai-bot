'use strict';

const OpenAI = require('openai');
const { getEnv } = require('../config/env');
const { generateTextOnly } = require('./gemini_service');
const { safeText } = require('../utils/formatters');

const env = getEnv();

let openaiClient = null;
function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function buildSystemPrompt() {
  return [
    'あなたは「ここから。」のAI牛込です。',
    'これは単なるダイエット記録AIではなく、人生の伴走OSです。',
    '利用者の言葉から感情・背景・言いにくさ・迷いを丁寧に読み取ってください。',
    '会話はChatGPTのように自然で、LINE向けにやや短くしてください。',
    '正論や説教を急がず、まず受け止めること。',
    '必要なら整理を一歩だけ進めること。',
    '質問は一度に多くても1つまで。',
    '相手が疲れていそうなら、短く安心感を優先すること。',
    '利用者の小さな工夫、頑張り、色どり、継続を見つけたら自然に褒めること。',
    '食事・運動・体調・家庭事情・気分の波を生活文脈として扱ってください。',
    'ダイエットが停滞していても、不安を煽らず、整えるヒントを短く返してください。',
    '返答は日本語。長すぎる補足は避ける。1〜5文程度。',
    '相手の誤入力や曖昧さを責めないこと。',
    '恋愛的・依存を誘う表現は避けること。',
  ].join('\n');
}

function buildUserPrompt({ user, text, recentTurns = [], memoryHints = [], mode = 'support' }) {
  const lines = [
    `現在メッセージ: ${String(text || '').trim()}`,
    `返答モード: ${mode}`,
    '',
    '利用者情報:',
    user?.display_name ? `- 呼び名: ${user.display_name}` : '- 呼び名: 未設定',
    user?.sex ? `- 性別: ${user.sex}` : '',
    user?.age ? `- 年齢: ${user.age}` : '',
    user?.height_cm ? `- 身長: ${user.height_cm}cm` : '',
    user?.weight_kg ? `- 現在体重候補: ${user.weight_kg}kg` : '',
    user?.target_weight_kg ? `- 目標体重: ${user.target_weight_kg}kg` : '',
    user?.activity_level ? `- 活動量: ${user.activity_level}` : '',
    '',
    '伴走に効くメモ:',
    ...(memoryHints.length ? memoryHints.map((x) => `- ${x}`) : ['- 特になし']),
    '',
    '直近の会話:',
    ...(recentTurns.length
      ? recentTurns.map((turn) => `- ${turn.role}: ${String(turn.text || '').slice(0, 200)}`)
      : ['- なし']),
    '',
    '返答の指示:',
    '- まず相手の気持ちや背景を1つ拾う',
    '- 必要な時だけ具体策を1つ',
    '- 次に言いやすい余白を残す',
    '- テンプレ感を出さない',
  ].filter(Boolean);

  return lines.join('\n');
}

async function generateSupportReply({ user = {}, text = '', recentTurns = [], memoryHints = [], mode = 'support' }) {
  const client = getOpenAIClient();
  const system = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ user, text, recentTurns, memoryHints, mode });

  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      const content = response?.choices?.[0]?.message?.content || '';
      if (content) return safeText(content, 1000);
    } catch (error) {
      console.warn('⚠️ OpenAI support reply failed:', error?.message || error);
    }
  }

  const geminiPrompt = `${system}\n\n${userPrompt}`;
  try {
    const textResult = await generateTextOnly(geminiPrompt, 0.7);
    return safeText(textResult, 1000);
  } catch (error) {
    console.warn('⚠️ Gemini support reply failed:', error?.message || error);
  }

  return '大丈夫です。今の感じをそのまま話してもらえたら、いっしょに整理していきます。';
}

module.exports = {
  generateSupportReply,
};
