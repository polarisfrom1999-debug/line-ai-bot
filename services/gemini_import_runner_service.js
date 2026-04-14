use strict';

const geminiCore = require('./gemini_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function stripCodeFence(text) {
  return normalizeText(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function removeTrailingCommas(text) {
  return String(text || '').replace(/,\s*([}\]])/g, '$1');
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

async function runStructured({ prompt, attachments }) {
  const imagePayloads = (attachments || [])
    .filter((attachment) => attachment?.buffer)
    .map((attachment) => ({
      buffer: attachment.buffer,
      mimeType: attachment.mimeType || 'image/jpeg',
    }));

  try {
    const result = await geminiCore.generateContentText({
      prompt,
      imagePayloads,
      model: process.env.GEMINI_IMPORT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      temperature: 0.1,
      maxOutputTokens: 3000,
    });

    const parsed = tryParseJson(result.text || '');
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    return buildFallbackObject('json_parse_failed', result.model, result.text || '');
  } catch (error) {
    const message = normalizeText(error?.message || 'client_unavailable') || 'client_unavailable';
    return buildFallbackObject(message, null, '');
  }
}

module.exports = {
  runStructured,
};
