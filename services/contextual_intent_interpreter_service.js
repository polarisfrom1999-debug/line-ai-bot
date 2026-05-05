'use strict';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function normalizeText(v) {
  return String(v || '').trim();
}

function buildFallbackInterpretation(input = {}) {
  const text = normalizeText(input.userText);
  const lower = text.toLowerCase();
  if (/(ジョギング|ランニング|ウォーキング|腕立て|スクワット|腹筋|背筋|プランク|筋トレ|体幹|回|km|分).*(した|やった|やりました)|\d+\s*(回|分|km)/.test(text)) {
    return { surface_intent: 'exercise_record', confidence: 0.9, entities: {} };
  }
  if (/(半分|1\/4|食べてない|完食|0kcal|麺だけ)/.test(text)) {
    return { surface_intent: 'meal_correction', confidence: 0.78, entities: {} };
  }
  if (/(TG|中性脂肪|hba1c|HbA1c|LDH|AST|ALT|血糖|クレアチニン|何読み取れた|他の日付)/i.test(text)) {
    return { surface_intent: 'lab_followup', confidence: 0.9, entities: {} };
  }
  if (/(今日の合計|今日どれくらい|本日の合計|今日の食事)/.test(text)) {
    return { surface_intent: 'daily_summary_request', confidence: 0.88, entities: {} };
  }
  if (/(腰が重い|痛い|しんどい|だるい)/.test(text)) {
    return { surface_intent: 'body_condition_note', confidence: 0.86, entities: {} };
  }
  if (/(ごはん|朝ごはん|昼ごはん|夜ごはん|食べた)/.test(text) && !/[?？]/.test(text)) {
    return { surface_intent: 'meal_record_text', confidence: 0.7, entities: {} };
  }
  return { surface_intent: 'normal_chat', confidence: 0.6, entities: {} };
}

async function callOpenAIForInterpretation(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(OPENAI_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a cautious intent interpreter for health coaching chat. Return JSON only.' },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content);
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function interpretContextualIntent(payload = {}) {
  const fallback = buildFallbackInterpretation(payload);
  const prompt = JSON.stringify({
    userText: payload.userText || '',
    activeContext: payload.activeContext || {},
    latestMealSummary: payload.latestMealSummary || {},
    latestExerciseSummary: payload.latestExerciseSummary || {},
    latestLabSummary: payload.latestLabSummary || {},
    todayNutritionSummary: payload.todayNutritionSummary || {},
    todayEnergyBalance: payload.todayEnergyBalance || {},
    recentConversationSummary: payload.recentConversationSummary || '',
    recentUncertaintySignals: payload.recentUncertaintySignals || [],
    previousCorrections: payload.previousCorrections || [],
    userProfile: payload.userProfile || {},
    timeOfDay: payload.timeOfDay || '',
    energyLevel: payload.energyLevel || ''
  });
  const ai = await callOpenAIForInterpretation(prompt);
  const merged = ai && typeof ai === 'object' ? ai : fallback;
  return {
    surface_intent: normalizeText(merged.surface_intent || fallback.surface_intent) || 'unknown',
    confidence: Number(merged.confidence ?? fallback.confidence ?? 0.5) || 0.5,
    entities: merged.entities && typeof merged.entities === 'object' ? merged.entities : {},
  };
}

module.exports = {
  interpretContextualIntent,
};

