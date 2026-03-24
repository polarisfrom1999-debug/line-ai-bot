'use strict';

const { getEnv } = require('../config/env');

let OpenAI = null;
try {
  OpenAI = require('openai');
} catch (_err) {
  OpenAI = null;
}

const env = getEnv();
const OpenAICtor = OpenAI && (OpenAI.default || OpenAI.OpenAI || OpenAI);
const openaiClient = OpenAICtor && env.OPENAI_API_KEY
  ? new OpenAICtor({ apiKey: env.OPENAI_API_KEY })
  : null;

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
  const match = String(text || '').match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function isProcedureIntent(text = '') {
  return hasAny(text, [
    'プラン教えて', '料金教えて', '料金', 'プラン', '無料体験', '体験', '入会', '会員', '契約',
    '継続', '停止', '再開', '現在のプラン', '今のプラン', '使い方', 'ヘルプ', 'メニュー',
  ]);
}

function isGraphIntent(text = '') {
  return hasAny(text, [
    'グラフ', 'グラフ見たい', 'グラフを見たい', 'グラフみたい', '見える化',
    '体重グラフ', '体重のグラフ', '体重推移',
    '食事活動グラフ', '食事グラフ', '活動グラフ', '運動グラフ',
    'hba1cグラフ', 'hb a1cグラフ', 'hb a 1c グラフ', 'hb a 1cグラフ', '血糖グラフ', 'ldlグラフ',
    '血液検査グラフ', '血液グラフ', '採血グラフ',
  ]);
}

function detectGraphType(text = '') {
  if (hasAny(text, ['体重グラフ', '体重のグラフ', '体重推移', '体重の推移', '体重を見たい'])) return 'weight';
  if (hasAny(text, ['食事活動グラフ', '食事グラフ', '活動グラフ', '運動グラフ', '食事と運動のグラフ'])) return 'energy';
  if (hasAny(text, ['hba1cグラフ', 'hb a1cグラフ', 'hb a 1c グラフ', 'hb a 1cグラフ', 'hba1c', 'hb a1c', 'hb a 1c', '血糖グラフ', 'ヘモグロビンa1cグラフ'])) return 'hba1c';
  if (hasAny(text, ['ldlグラフ', 'ldl', 'コレステロールグラフ', '悪玉コレステロールグラフ'])) return 'ldl';
  if (hasAny(text, ['血液検査グラフ', '血液グラフ', '採血グラフ', '血液データを見たい'])) return 'lab';
  return 'menu';
}

function isConsultationIntent(text = '') {
  return hasAny(text, [
    '痛い', '痛み', 'つらい', 'しんどい', '不安', '心配', '相談', '悩み', '困って', 'どうしたら',
    'どうすれば', 'かな', 'ですか', 'ますか', '大丈夫', '平気', 'だめ', 'ダメ', '歩いてよい', '歩いていい',
    '教えて', 'あるの', 'あるかな', '方法', 'やり方', 'コツ', 'いいの', 'いいかな', '嫌い',
    '痺れ', 'しびれ', '張る', '重い', 'だるい', '違和感',
  ]);
}

function isQuestionLike(text = '') {
  return /[?？]|ですか|ますか|かな|あるの|教えて|やり方|方法|どうしたら|どうすれば/.test(String(text || '').trim());
}

function isShortSymptomFollowup(text = '') {
  const raw = String(text || '').trim();
  if (!raw || raw.length > 24) return false;

  return hasAny(raw, [
    '太もも', '太腿', '裏もも', 'もも裏', 'ふくらはぎ', '足首', '足裏', 'かかと', '腰', '背中', '首', '肩',
    'お尻', '臀部', '股関節', '膝', 'すね', '脛', '足の裏', '坐骨',
    '右', '左', '両方', '片側', '裏側', '表側', '外側', '内側',
    '座ると', '立つと', '歩くと', '寝ると', '朝だけ', '夜だけ', '長時間',
    'ピリピリ', 'ジンジン', 'ズキズキ', '重だるい', 'つっぱる', '痺れる', 'しびれる',
  ]);
}

function recentMessagesIndicateConsultation(recentMessages = []) {
  if (!Array.isArray(recentMessages) || !recentMessages.length) return false;

  const joined = recentMessages
    .slice(-8)
    .map((m) => `${m?.role || ''}:${m?.content || m?.text || ''}`)
    .join('\n');

  return hasAny(joined, [
    '痛い', '痛み', '痺れ', 'しびれ', 'つらい', '不安', '心配', '相談',
    'ストレッチ', 'やり方', '教えて', 'どうしたら', 'どうすれば', '楽になる',
  ]);
}

function isWeightOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  if (/^\d{2,3}(?:\.\d)?(?:kg|キロ|きろ)?$/.test(t)) return true;
  if (t.includes('体重')) return true;
  return false;
}

function isBodyFatOnly(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  if (t.includes('体脂肪')) return true;
  if (/^\d{1,2}(?:\.\d)?(?:%|％)$/.test(t)) return true;
  return false;
}

function isExerciseQuestion(text = '') {
  return hasAny(text, ['ストレッチ', '筋トレ', '運動', '歩く', '歩いた', '走る', 'ジョギング', 'ランニング'])
    && isQuestionLike(text);
}

function isExerciseRecord(text = '') {
  return hasAny(text, [
    '歩いた', 'ウォーキング', '散歩', '走った', 'ジョギング', 'ランニング', '筋トレ', 'ストレッチ', '運動した',
  ]) && !isConsultationIntent(text) && !isExerciseQuestion(text);
}

function isMealRecord(text = '') {
  return hasAny(text, [
    '食べた', '食事', '朝ごはん', '昼ごはん', '夜ごはん', '朝食', '昼食', '夕食', 'おやつ', '飲んだ',
  ]) && !hasAny(text, ['食べたい', 'お腹いっぱい食べたい', '食欲']);
}

function buildWeightCandidate(text = '') {
  const value = parseNumber(text);
  if (!Number.isFinite(value)) return null;
  return { type: 'weight', parsed_payload: { weight_kg: value }, confidence: 0.96, source_text: text };
}

function buildBodyFatCandidate(text = '') {
  const value = parseNumber(text);
  if (!Number.isFinite(value)) return null;
  return { type: 'body_fat', parsed_payload: { body_fat_percent: value }, confidence: 0.95, source_text: text };
}

function buildExerciseCandidate(text = '') {
  return { type: 'exercise', parsed_payload: { raw_text: String(text || '').trim() }, confidence: 0.8, source_text: text };
}

function buildMealCandidate(text = '') {
  return { type: 'meal', parsed_payload: { raw_text: String(text || '').trim() }, confidence: 0.78, source_text: text };
}

function buildFallbackReply(text = '', context = {}) {
  const displayName = String(context?.display_name || '').trim();
  const prefix = displayName ? `${displayName}さん、` : '';

  if (hasAny(text, ['疲れた', 'しんどい', 'だるい'])) {
    return `${prefix}それは今日は少し重たいですね。無理に整えようとしすぎず、まずは話しやすいところからで大丈夫です。`;
  }
  if (hasAny(text, ['外食', '飲み会'])) {
    return `${prefix}そういう日ありますよ。崩れたと決めなくて大丈夫なので、今日は流れを見ながら少しずつ戻していきましょう。`;
  }
  if (hasAny(text, ['うれしい', '嬉しい', 'できた'])) {
    return `${prefix}それはいい流れですね。派手じゃなくても、そういう積み重ねはちゃんと効いてきます。`;
  }
  return `${prefix}ありがとうございます。ちゃんと見ていますよ。このまま話しやすいところから続けてくださいね。`;
}

function extractOutputText(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text.trim();
  const arr = Array.isArray(response.output) ? response.output : [];
  for (const item of arr) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      const t = c?.text || c?.output_text || '';
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
  }
  return '';
}

async function buildOpenAIReply({ text = '', context = {}, recentMessages = [] } = {}) {
  if (!openaiClient || !env.OPENAI_API_KEY) return '';

  const displayName = String(context?.display_name || '').trim();
  const recent = Array.isArray(recentMessages) && recentMessages.length
    ? recentMessages.slice(-6).map((m) => `${m?.role || ''}: ${m?.content || m?.text || ''}`).join('\n')
    : 'なし';

  const system = [
    'あなたは「ここから。」のAI牛込です。',
    'LINEで返すため、返答は短く自然にしてください。',
    'まず相手の気持ちや具体を受け止め、その後に必要なら一言だけ役立つことを返してください。',
    '定型文っぽさを避け、1〜4文程度で返してください。',
    '病名断定や強い不安喚起はしないでください。',
  ].join('\n');

  const userPrompt = [
    displayName ? `表示名: ${displayName}` : '表示名: なし',
    `直近メッセージ:\n${recent}`,
    `今回の利用者発話: ${text}`,
    '出力は、そのままLINEで返せる文章のみ。',
  ].join('\n\n');

  try {
    if (openaiClient.responses && typeof openaiClient.responses.create === 'function') {
      const response = await openaiClient.responses.create({
        model: env.OPENAI_MODEL,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        max_output_tokens: 220,
      });
      return extractOutputText(response);
    }

    if (openaiClient.chat && openaiClient.chat.completions && typeof openaiClient.chat.completions.create === 'function') {
      const completion = await openaiClient.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 220,
      });
      return String(completion?.choices?.[0]?.message?.content || '').trim();
    }
  } catch (error) {
    console.warn('⚠️ OpenAI routeConversation failed:', error?.message || error);
  }

  return '';
}

async function routeConversation(input = {}) {
  const text = String(input.currentUserText || input.text || '').trim();
  const recentMessages = Array.isArray(input.recentMessages) ? input.recentMessages : [];
  const context = input.context || {};
  const normalized = normalizeText(text);
  const recentText = recentMessages.map((m) => `${m?.role || ''}:${m?.content || m?.text || ''}`).join('\n');
  const recentConsultation = recentMessagesIndicateConsultation(recentMessages);

  if (!normalized) {
    return {
      route: 'smalltalk',
      is_ambiguous: true,
      needs_clarification: true,
      replyText: 'ありがとうございます。続けて教えてくださいね。',
      meta: { topic_hints: {} },
    };
  }

  if (isProcedureIntent(text)) {
    return { route: 'procedure', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { procedure: true } } };
  }
  if (isGraphIntent(text)) {
    return { route: 'graph', is_ambiguous: false, needs_clarification: false, graph_type: detectGraphType(text), meta: { topic_hints: { graph: true } } };
  }
  if (isWeightOnly(text)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildWeightCandidate(text), meta: { topic_hints: { body_metrics: true, weight: true } } };
  }
  if (isBodyFatOnly(text)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildBodyFatCandidate(text), meta: { topic_hints: { body_metrics: true, body_fat: true } } };
  }
  if (recentConsultation && isShortSymptomFollowup(text)) {
    return { route: 'consultation', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { consultation: true, followup_detail: true, recent_context: true } } };
  }
  if (isConsultationIntent(text) || isExerciseQuestion(text)) {
    return { route: 'consultation', is_ambiguous: false, needs_clarification: false, meta: { topic_hints: { consultation: true, recent_context: Boolean(recentText) } } };
  }
  if (isExerciseRecord(text)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildExerciseCandidate(text), meta: { topic_hints: { exercise: true } } };
  }
  if (isMealRecord(text)) {
    return { route: 'record_candidate', is_ambiguous: false, needs_clarification: false, top_record_candidate: buildMealCandidate(text), meta: { topic_hints: { meal: true } } };
  }

  const aiReply = await buildOpenAIReply({ text, context, recentMessages });
  return {
    route: 'smalltalk',
    is_ambiguous: false,
    needs_clarification: false,
    replyText: aiReply || buildFallbackReply(text, context),
    meta: { topic_hints: { smalltalk: true } },
  };
}

module.exports = {
  routeConversation,
};
