'use strict';

const { GoogleGenAI } = require('@google/genai');
const corePersonality = require('../prompts/kokokara_core_personality_prompt');
const motionPrompt = require('../prompts/kokokara_motion_analysis_prompt');
const responseRules = require('../prompts/kokokara_response_style_rules');
const menuRehabRules = require('../prompts/kokokara_menu_rehab_rules');


const PRIMARY_MODEL = process.env.GEMINI_MOTION_MODEL || 'gemini-2.5-flash-lite';
const FALLBACK_MODEL = process.env.GEMINI_MOTION_FALLBACK_MODEL || 'gemini-1.5-flash';
function normalizeText(value) {
  return String(value || '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((v) => normalizeText(v)).filter(Boolean) : [];
}

function hasJapanese(text) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(text || ''));
}

function localizeForJapaneseAudience(text, fallbackText) {
  const safe = normalizeText(text);
  if (!safe) return normalizeText(fallbackText);
  if (hasJapanese(safe)) return safe;
  return normalizeText(fallbackText);
}

function inferTimeOfDay() {
  const hour = Number(new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }).format(new Date()));
  if (hour < 11) return 'morning';
  if (hour >= 18) return 'night';
  return 'daytime';
}

function inferEnergyLevel(textHint) {
  const safe = normalizeText(textHint);
  if (!safe) return 'normal';
  if (/疲れ|しんど|きつい|眠い|痛い|不安|怖い|重い/.test(safe)) return 'low';
  return 'normal';
}

function normalizeEnergyLevelSafe(value) {
  const input = String(value || 'unknown').trim().toLowerCase();
  if (['very_low', 'low', 'medium', 'high', 'very_high', 'unknown'].includes(input)) return input;
  if (['1', '2'].includes(input)) return 'very_low';
  if (['3', '4'].includes(input)) return 'low';
  if (['5', '6'].includes(input)) return 'medium';
  if (['7', '8'].includes(input)) return 'high';
  if (['9', '10'].includes(input)) return 'very_high';
  return 'unknown';
}

function getImageProcessorOptional() {
  try {
    return require('./image_processor');
  } catch (_error) {
    return null;
  }
}

async function compactInlineFramesSafe(frames, options = {}) {
  const processor = getImageProcessorOptional();
  if (processor && typeof processor.compactInlineFrames === 'function') {
    return processor.compactInlineFrames(frames, options);
  }
  return frames;
}

function getGeminiApiKey() {
  return normalizeText(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '');
}

function getGeminiClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

function buildSystemPrompt({ timeOfDay, energyLevel }) {
  const timeHint = responseRules.timeModifiers[timeOfDay] || responseRules.timeModifiers.daytime;
  const energyHint = energyLevel === 'low'
    ? responseRules.energyLevelRule
    : '必要十分な情報量で返す';

  return [
    '【最上位思想】正しさの押し付けではなく、可能性の発見を最優先する。',
    '【実装姿勢】強みを先に返し、心理状態は断定せず問いかけベースで扱い、修正提案は最大2個まで。',
    corePersonality,
    motionPrompt,
    menuRehabRules,
    '【言語】ユーザー向け本文は必ず自然な日本語で記述する。英語での説明文は禁止。',
    '【言語】JSONキー名はスキーマに従い英語のままでよいが、各値の文章は日本語のみで書く。',
    `【時間補正】${timeHint}`,
    `【energy_level補正】${energyHint}`,
    '【出力制約】必ず JSON のみを返す。コードブロックは禁止。主観的な褒めは具体的な観察事実に紐づける。心理状態は断定せず仮説として扱う。'
  ].join('\n\n');
}

function getSchema() {
  return {
    type: 'object',
    properties: {
      isMotionRelated: { type: 'boolean' },
      motionType: { type: 'string' },
      facts: { type: 'array', items: { type: 'string' } },
      strengths: { type: 'array', items: { type: 'string' } },
      concerns: { type: 'array', items: { type: 'string' } },
      backgroundHypotheses: { type: 'array', items: { type: 'string' } },
      keepPoints: { type: 'array', items: { type: 'string' } },
      cautions: { type: 'array', items: { type: 'string' } },
      smallActions: { type: 'array', items: { type: 'string' } },
      dailyLifeTranslation: { type: 'array', items: { type: 'string' } },
      performanceBenefits: { type: 'array', items: { type: 'string' } },
      encouragement: { type: 'string' },
      safetyMessage: { type: 'string' },
      medicalConsultFlag: { type: 'string' }
    },
    required: ['isMotionRelated', 'facts', 'strengths', 'concerns', 'smallActions', 'encouragement']
  };
}

function stripMarkdownJson(text) {
  const safe = normalizeText(text);
  if (!safe) return '';
  return safe
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractJsonCandidate(text) {
  const safe = stripMarkdownJson(text);
  const match = safe.match(/\{[\s\S]*\}/);
  return match ? match[0] : safe;
}

function safeParseResponseJson(rawText) {
  const candidate = extractJsonCandidate(rawText);
  if (!candidate) return null;
  const attempts = [
    candidate,
    candidate.replace(/,\s*([}\]])/g, '$1'),
  ];
  for (const value of attempts) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      // no-op
    }
  }
  return null;
}

function normalizeResult(raw = {}) {
  const facts = asArray(raw.facts).slice(0, 2).map((v) => localizeForJapaneseAudience(v, '見えている動きの特徴があります。'));
  const strengths = asArray(raw.strengths).slice(0, 2).map((v) => localizeForJapaneseAudience(v, '今の動きには活かせる強みがあります。'));
  const concerns = asArray(raw.concerns).slice(0, 2).map((v) => localizeForJapaneseAudience(v, '気になる点はありますが、急いで変えなくて大丈夫です。'));
  const backgroundHypotheses = asArray(raw.backgroundHypotheses).slice(0, 1).map((v) => localizeForJapaneseAudience(v, '撮影条件や疲労で見え方が変わる可能性があります。'));
  const keepPoints = asArray(raw.keepPoints).slice(0, 1).map((v) => localizeForJapaneseAudience(v, '今のやりやすさは大切に残しましょう。'));
  const cautions = asArray(raw.cautions).slice(0, 1).map((v) => localizeForJapaneseAudience(v, '痛みが増える場合は無理せず中断しましょう。'));
  const smallActions = asArray(raw.smallActions).slice(0, 2).map((v) => localizeForJapaneseAudience(v, '今日は1つだけ小さな修正を試してみましょう。'));
  const dailyLifeTranslation = asArray(raw.dailyLifeTranslation).slice(0, 1).map((v) => localizeForJapaneseAudience(v, 'この調整は日常動作の安定にもつながります。'));
  const performanceBenefits = asArray(raw.performanceBenefits).slice(0, 1).map((v) => localizeForJapaneseAudience(v, '小さな調整で動きの再現性が高まりやすくなります。'));

  return {
    isMotionRelated: Boolean(raw.isMotionRelated),
    motionType: localizeForJapaneseAudience(raw.motionType || 'motion', '動作'),
    facts,
    strengths,
    concerns,
    backgroundHypotheses,
    keepPoints,
    cautions,
    smallActions,
    dailyLifeTranslation,
    performanceBenefits,
    encouragement: localizeForJapaneseAudience(raw.encouragement || '', '今の良さを活かしながら、あなたのペースで進めば大丈夫です。'),
    safetyMessage: localizeForJapaneseAudience(raw.safetyMessage || '', '痛みが増える場合は中断し、休息を優先してください。'),
    medicalConsultFlag: localizeForJapaneseAudience(raw.medicalConsultFlag || '', '')
  };
}

function buildReplyText(result) {
  const strengthLines = [];
  if (result.strengths.length) {
    strengthLines.push(...result.strengths);
  } else if (result.facts.length) {
    strengthLines.push(...result.facts.slice(0, 2));
  }

  const lines = [];

  if (strengthLines.length) {
    lines.push('【見える強み】');
    strengthLines.slice(0, 2).forEach((v) => lines.push(`・${v}`));
  }

  if (result.concerns.length) {
    lines.push('');
    lines.push('【気になる点】');
    result.concerns.slice(0, 2).forEach((v) => lines.push(`・${v}`));
  }

  if (result.backgroundHypotheses.length) {
    lines.push('');
    lines.push(`【背景の仮説】${result.backgroundHypotheses[0]}`);
  }

  if (result.smallActions.length) {
    lines.push('');
    lines.push('【今日からの小さな修正】');
    result.smallActions.slice(0, 2).forEach((v) => lines.push(`・${v}`));
  }

  const dailyOne = result.dailyLifeTranslation[0] || result.performanceBenefits[0] || '';
  if (dailyOne) {
    lines.push('');
    lines.push(`【日常へのひとこと】${dailyOne}`);
  }

  if (result.safetyMessage) {
    lines.push('');
    lines.push(result.safetyMessage);
  } else if (result.cautions.length) {
    lines.push('');
    lines.push(`【無理しない目安】${result.cautions[0]}`);
  }

  if (result.medicalConsultFlag) {
    lines.push('');
    lines.push(result.medicalConsultFlag);
  } else if (result.encouragement && lines.join('\n').length < 320) {
    lines.push('');
    lines.push(result.encouragement);
  }

  let out = lines.filter(Boolean).join('\n');
  if (out.length > 620) {
    out = `${out.slice(0, 600).trim()}…\n（詳しく知りたければ「もう少し詳しく」と送ってください）`;
  }
  return out;
}

function buildFallbackResult(textHint) {
  const low = inferEnergyLevel(textHint) === 'low';
  const result = normalizeResult({
    isMotionRelated: true,
    motionType: 'general_motion',
    facts: ['画像は受け取れています。'],
    strengths: ['今の段階でも、動きを見直そうとしている姿勢そのものが前進です。'],
    concerns: low ? ['今日は無理に細かく直すより、負担を増やさない見方が安全です。'] : ['細かなフォーム解析は次回もう少し情報を増やして見ると精度が上がります。'],
    backgroundHypotheses: ['撮影角度や枚数で見え方が変わることがあります。'],
    keepPoints: ['まずは動きを止めずに続けられることを大事にしてください。'],
    smallActions: low ? ['今日は1つだけ、深呼吸して力みを抜いた状態で同じ動きを1回だけ試してください。'] : ['正面か側面で、同じ動きをもう1枚だけ送ると見え方が揃います。'],
    dailyLifeTranslation: ['この整え方は、階段を上る時の踏み込みや立ち座りの安定にもつながります。'],
    performanceBenefits: ['小さく整えるだけでも、動きやすさと再現性につながります。'],
    encouragement: low ? '今日は詰め込みすぎなくて大丈夫です。まずは楽にできる感覚を残していきましょう。' : '今の良さを消さずに整えていけば、十分伸びていけます。',
    safetyMessage: '痛みが増える場合は中断し、休息を優先してください。',
    medicalConsultFlag: ''
  });
  return { ...result, replyText: buildReplyText(result) };
}

function toInlineImage(payload) {
  if (!payload) return null;
  if (payload.inlineData?.data) {
    return { data: payload.inlineData.data, mimeType: payload.inlineData.mimeType || payload.mimeType || 'image/jpeg' };
  }
  if (payload.data && payload.mimeType) {
    return { data: String(payload.data), mimeType: payload.mimeType };
  }
  if (Buffer.isBuffer(payload.buffer)) {
    return { data: payload.buffer.toString('base64'), mimeType: payload.mimeType || payload.mimetype || 'image/jpeg' };
  }
  if (typeof payload.base64 === 'string' && payload.base64) {
    return { data: payload.base64, mimeType: payload.mimeType || payload.mimetype || 'image/jpeg' };
  }
  return null;
}

function buildUserContextText(context = {}) {
  const pairs = [
    ['sport', context.sport],
    ['motionType', context.motionType],
    ['symptoms', context.symptoms],
    ['goal', context.goal],
    ['note', context.note],
    ['timeOfDay', context.timeOfDay],
    ['energyLevel', context.energyLevel],
    ['userProfile', context.userProfile],
  ];
  const lines = pairs
    .map(([key, value]) => `${key}: ${normalizeText(value) || '未指定'}`);
  return lines.join('\n');
}

function extractStatusCode(error) {
  return Number(error?.status || error?.response?.status || error?.cause?.status || 0);
}

function isRetryable503(error) {
  return extractStatusCode(error) === 503;
}

function isPayloadTooLarge(error) {
  const status = extractStatusCode(error);
  const message = normalizeText(error?.message || '').toLowerCase();
  return status === 413 || message.includes('request too large') || message.includes('payload too large');
}

async function callGeminiJson({ model, prompt, inlineImages, maxOutputTokens = 1200, temperature = 0.2 }) {
  const client = getGeminiClient();
  if (!client) throw new Error('Gemini API key is missing.');

  const parts = [{ text: prompt }];
  inlineImages.forEach((img) => {
    parts.push({ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.data } });
  });

  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      temperature,
      maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: getSchema(),
    },
  });

  const text = normalizeText(
    response?.text ||
    response?.candidates?.[0]?.content?.parts?.map((part) => normalizeText(part?.text)).filter(Boolean).join('\n') ||
    ''
  );
  const parsed = safeParseResponseJson(text);
  if (!parsed) {
    throw new Error('Gemini JSON parse failed.');
  }

  return { parsed, raw: response };
}

async function analyzeWithModelFallback({ prompt, inlineImages }) {
  const candidates = [PRIMARY_MODEL, FALLBACK_MODEL];
  let payloads = inlineImages;
  let lastError = null;

  for (const model of candidates) {
    let retryCount = 0;
    let delayMs = 800;
    while (retryCount <= 3) {
      try {
        const result = await callGeminiJson({ model, prompt, inlineImages: payloads });
        return { model, ...result };
      } catch (error) {
        lastError = error;
        if (isPayloadTooLarge(error)) {
          payloads = await compactInlineFramesSafe(payloads, {
            maxDimension: 760,
            maxBytesPerImage: 180 * 1024,
            quality: 62,
          });
          retryCount += 1;
          continue;
        }
        if (isRetryable503(error)) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2;
          retryCount += 1;
          continue;
        }
        break;
      }
    }
  }

  throw lastError || new Error('Motion analysis failed on all models.');
}

async function analyzeMotionFrames({ frames = [], context = {}, userId = '' } = {}) {
  const inlineImages = (Array.isArray(frames) ? frames : [])
    .map(toInlineImage)
    .filter(Boolean)
    .slice(0, 5);

  if (!inlineImages.length) {
    return buildFallbackResult(context.note || '');
  }

  const hintedTime = normalizeText(context.timeOfDay);
  const timeOfDay = hintedTime || inferTimeOfDay();
  const energyLevel = normalizeEnergyLevelSafe(context.energyLevel || inferEnergyLevel(context.note || ''));

  const prompt = [
    buildSystemPrompt({ timeOfDay, energyLevel: energyLevel === 'very_low' || energyLevel === 'low' ? 'low' : 'normal' }),
    'あなたは柔道整復師的な安全感覚と日本代表トレーナーの観察眼を併せ持つ解析者です。医療診断の断定は禁止です。',
    '次の画像群を統合して解析し、必ずJSONのみで返してください。',
    '出力順は facts -> strengths -> concerns -> backgroundHypotheses -> smallActions -> dailyLifeTranslation -> safetyMessage を守ること。',
    'ユーザーに見える文章は必ず日本語にする。英語の説明文や英単語中心の文は作らない。',
    '強みは必ず1〜2個、気になる点は最大2個、修正案は最大2個。',
    `ユーザー文脈:\n${buildUserContextText(context)}`,
  ].join('\n\n');

  try {
    const result = await analyzeWithModelFallback({ prompt, inlineImages });
    const normalized = normalizeResult(result?.parsed || {});
    if (!normalized.isMotionRelated) {
      return {
        ...normalized,
        usedModel: result?.model || '',
        replyText: 'この画像は動作解析の対象としては読み取り切れませんでした。正面・側面・後面のいずれかが分かる画像だと見やすくなります。',
      };
    }
    return {
      ...normalized,
      usedModel: result?.model || '',
      replyText: buildReplyText(normalized),
    };
  } catch (error) {
    console.error('[motion_analysis_service] analyzeMotionFrames error:', error?.message || error, { userId });
    return buildFallbackResult(context.note || '');
  }
}

async function analyzeMotionImage({ imagePayload, imagePayloads, textHint = '', userId = '' } = {}) {
  const payloads = Array.isArray(imagePayloads) && imagePayloads.length
    ? imagePayloads.filter(Boolean)
    : (imagePayload ? [imagePayload] : []);

  if (!payloads.length) {
    return buildFallbackResult(textHint);
  }
  return analyzeMotionFrames({
    frames: payloads,
    context: { note: textHint },
    userId,
  });
}

module.exports = {
  analyzeMotionFrames,
  analyzeMotionImage,
  buildSystemPrompt,
  buildReplyText,
  normalizeResult,
};
