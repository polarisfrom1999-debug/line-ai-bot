'use strict';

let GoogleGenAI = null;
try {
  ({ GoogleGenAI } = require('@google/genai'));
} catch (_) {
  GoogleGenAI = null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!apiKey || !GoogleGenAI) return null;
  try {
    return new GoogleGenAI({ apiKey });
  } catch (_error) {
    return null;
  }
}

function candidateModels() {
  const seen = new Set();
  const list = [];
  for (const model of [
    process.env.GEMINI_IMPORT_MODEL,
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
  ]) {
    const safe = normalizeText(model);
    if (!safe || safe === 'gemini-2.0-flash' || seen.has(safe)) continue;
    seen.add(safe);
    list.push(safe);
  }
  return list.length ? list : ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
}

function buildParts(prompt, attachments) {
  const parts = [{ text: prompt }];
  for (const attachment of attachments || []) {
    if (!attachment?.buffer) continue;
    parts.push({
      inlineData: {
        data: attachment.buffer.toString('base64'),
        mimeType: attachment.mimeType || 'image/jpeg',
      },
    });
  }
  return parts;
}

function stripCodeFence(text) {
  return normalizeText(text).replace(/```json/gi, '').replace(/```/g, '').trim();
}

function removeTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

function extractBalancedJsonCandidates(text) {
  const safe = stripCodeFence(text);
  const candidates = [];
  for (let i = 0; i < safe.length; i += 1) {
    const opener = safe[i];
    if (opener !== '{' && opener !== '[') continue;
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < safe.length; j += 1) {
      const ch = safe[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === opener) depth += 1;
      if (ch === closer) {
        depth -= 1;
        if (depth === 0) {
          candidates.push(safe.slice(i, j + 1));
          break;
        }
      }
    }
  }
  return [...new Set(candidates)].sort((a, b) => b.length - a.length);
}

function tryParseJson(text) {
  const safe = stripCodeFence(text);
  if (!safe) return null;

  const attempts = [safe, removeTrailingCommas(safe), ...extractBalancedJsonCandidates(safe).flatMap((v) => [v, removeTrailingCommas(v)])];
  for (const candidate of attempts) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // continue
    }
  }
  return null;
}

function extractText(result) {
  if (!result) return '';
  if (typeof result.text === 'string') return normalizeText(result.text);
  const parts = result?.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => normalizeText(part?.text || '')).filter(Boolean).join('\n');
}

function buildFallbackObject(reason, model, rawText) {
  const excerpt = normalizeText(rawText).slice(0, 1500);
  return {
    document_type: 'unknown',
    session_summary: '',
    tables: [],
    issues: [reason, model ? `model:${model}` : null, excerpt ? `raw_excerpt:${excerpt}` : null].filter(Boolean),
    confidence: 0,
  };
}

async function generateWithModel({ client, model, prompt, attachments, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: buildParts(prompt, attachments) }],
      config: {
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: 3000,
      },
      signal: controller.signal,
    });
    const text = extractText(result);
    return { ok: Boolean(text), text, model, reason: text ? null : 'empty_text' };
  } catch (error) {
    return { ok: false, text: '', model, reason: normalizeText(error?.message || 'analysis_error') || 'analysis_error' };
  } finally {
    clearTimeout(timer);
  }
}

async function runStructured({ prompt, attachments }) {
  const client = getClient();
  if (!client) {
    return buildFallbackObject('client_unavailable', null, '');
  }
  const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 20000);
  let lastText = '';
  const reasons = [];

  for (const model of candidateModels()) {
    const result = await generateWithModel({ client, model, prompt, attachments, timeoutMs });
    if (!result.ok) {
      reasons.push(result.reason || `model_failed:${model}`);
      continue;
    }
    lastText = result.text || '';
    const parsed = tryParseJson(lastText);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    reasons.push(`json_parse_failed:${model}`);
  }

  return buildFallbackObject(reasons.join(' | ') || 'all_models_failed', null, lastText);
}

module.exports = {
  runStructured,
};
