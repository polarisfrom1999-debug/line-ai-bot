'use strict';

const { runDomainImport } = require('./gemini_import_orchestrator_service');

const promptBuilder = {
  async build({ attachments, sessionMeta }) {
    const hint = sessionMeta?.angle_hint ? `角度ヒント: ${sessionMeta.angle_hint}` : '角度ヒントなし';
    return {
      schemaName: 'movement_import_v1',
      promptVersion: 'movement_import_v1',
      prompt: [
        'あなたは走動作・フォーム動画の構造化担当です。',
        '必ず JSON だけを返してください。',
        '診断ではなく観察事実と負荷リスク候補だけを書いてください。',
        '{',
        '  "clip_roles": ["side", "rear", "front"],',
        '  "summary": "...",',
        '  "findings": {',
        '    "foot_strike": "forefoot | midfoot | heel | unclear",',
        '    "heel_contact": "clear | partial | minimal | unclear",',
        '    "knee_tracking": "neutral | inward | outward | unclear",',
        '    "trunk_stability": "stable | mild_sway | large_sway | unclear",',
        '    "asymmetry": "none | mild | moderate | severe | unclear",',
        '    "achilles_load_risk": "low | medium | high | unclear"',
        '  },',
        '  "coach_cues": ["..."],',
        '  "drills": ["..."],',
        '  "needs_more_views": [],',
        '  "confidence": 0.0',
        '}',
        `素材数: ${attachments.length}`,
        hint,
      ].join('\n'),
    };
  },
};

const thinNormalizer = {
  async normalize({ raw }) {
    return {
      summary: raw?.summary || null,
      clip_roles: Array.isArray(raw?.clip_roles) ? raw.clip_roles : [],
      findings: raw?.findings || {},
      coach_cues: Array.isArray(raw?.coach_cues) ? raw.coach_cues : [],
      drills: Array.isArray(raw?.drills) ? raw.drills : [],
      needs_more_views: Array.isArray(raw?.needs_more_views) ? raw.needs_more_views : [],
      confidence: raw?.confidence ?? null,
    };
  },
};

async function importMovementWithGemini({ userId, attachments, geminiRunner, store, sessionMeta }) {
  return runDomainImport({
    userId,
    domain: 'movement',
    attachments,
    promptBuilder,
    geminiRunner,
    store,
    thinNormalizer,
    sessionMeta,
  });
}

module.exports = {
  importMovementWithGemini,
};
