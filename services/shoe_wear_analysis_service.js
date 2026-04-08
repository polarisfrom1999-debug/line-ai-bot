'use strict';

const { buildShoeWearExtractPrompt } = require('./shoe_wear_extract_prompt_builder_service');
const geminiDispatchService = require('./gemini_dispatch_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildFallback(rawText = '') {
  return {
    is_shoe_wear_image: /靴|靴底|ソール/.test(normalizeText(rawText)),
    side: '',
    wear_regions: [],
    asymmetry_notes: [],
    movement_hypotheses: [],
    issues: ['gemini_unavailable'],
    confidence: 0.18
  };
}

async function analyzeShoeWearImage(imagePayload, options = {}) {
  const config = buildShoeWearExtractPrompt(options);
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
      imageType: 'shoe_wear',
      isShoeWearImage: json.is_shoe_wear_image === true,
      confidence: Number(json.confidence || 0) || 0,
      side: normalizeText(json.side || ''),
      wearRegions: Array.isArray(json.wear_regions) ? json.wear_regions : [],
      asymmetryNotes: Array.isArray(json.asymmetry_notes) ? json.asymmetry_notes : [],
      movementHypotheses: Array.isArray(json.movement_hypotheses) ? json.movement_hypotheses : [],
      issues: Array.isArray(json.issues) ? json.issues : [],
      rawGeminiPayload: json,
      promptVersion: config.promptVersion
    };
  } catch (error) {
    console.error('[shoe_wear_analysis_service] error:', error?.message || error);
    return {
      source: 'image',
      imageType: 'shoe_wear',
      isShoeWearImage: false,
      ...buildFallback(options.rawText || ''),
      errorMessage: String(error?.message || error || '')
    };
  }
}

module.exports = {
  analyzeShoeWearImage
};
