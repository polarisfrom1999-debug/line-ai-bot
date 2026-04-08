'use strict';

const { buildMovementExtractPrompt } = require('./movement_extract_prompt_builder_service');
const geminiDispatchService = require('./gemini_dispatch_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function analyzeMovementStillImage(imagePayload, options = {}) {
  const config = buildMovementExtractPrompt({
    ...options,
    mode: 'still'
  });

  try {
    const result = await geminiDispatchService.generateStructuredImageJson({
      imagePayload,
      prompt: config.prompt,
      schema: config.schema,
      domain: config.domain,
      model: config.preferredModel,
      temperature: config.temperature
    });

    const json = result?.json || {};
    return {
      source: 'image',
      imageType: 'movement_still',
      isMovementImage: json.is_movement_media === true,
      confidence: Number(json.confidence || 0) || 0,
      angle: normalizeText(json.angle || ''),
      focusPoints: Array.isArray(json.focus_points) ? json.focus_points : [],
      asymmetryNotes: Array.isArray(json.asymmetry_notes) ? json.asymmetry_notes : [],
      postureNotes: Array.isArray(json.posture_notes) ? json.posture_notes : [],
      nextBestAngle: normalizeText(json.next_best_angle || ''),
      issues: Array.isArray(json.issues) ? json.issues : [],
      rawGeminiPayload: json,
      promptVersion: config.promptVersion
    };
  } catch (error) {
    console.error('[movement_still_analysis_service] error:', error?.message || error);
    return {
      source: 'image',
      imageType: 'movement_still',
      isMovementImage: false,
      confidence: 0,
      angle: '',
      focusPoints: [],
      asymmetryNotes: [],
      postureNotes: [],
      nextBestAngle: '',
      issues: ['gemini_unavailable'],
      errorMessage: String(error?.message || error || '')
    };
  }
}

module.exports = {
  analyzeMovementStillImage
};
