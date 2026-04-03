'use strict';

const {
  parseLabImageAnalysis,
  makeLabSessionState,
  handleLabFollowup,
  buildDateListReply,
} = require('./lab_image_analysis_service');
const { buildConversationBridge } = require('./conversation_bridge_service');
const { buildReentryGuide } = require('./reentry_guide_service');
const { buildSupportMode } = require('./support_mode_service');
const { buildConsultationCompass } = require('./consultation_compass_service');
const { buildSportsConsultationFrame } = require('./sports_consultation_service');
const { buildMovementAnalysisHint } = require('./movement_analysis_service');
const {
  parseExplicitProfileInput,
  mergeProfile,
  answerProfileQuestion,
} = require('./profile_service');

function buildGuidanceContext({ profile, memory, latestInput, labState, lastUserAt }) {
  return {
    bridge: buildConversationBridge({ profile, memory }),
    reentryGuide: buildReentryGuide({ lastUserAt, profile }),
    supportMode: buildSupportMode({ profile, memory, latestInput }),
    compass: buildConsultationCompass({ latestInput, labState }),
    sports: buildSportsConsultationFrame({ latestInput }),
    movement: buildMovementAnalysisHint({ latestInput }),
  };
}

async function orchestrateConversation({
  userText,
  state = {},
  imageAnalysis = null,
  generateReply,
  saveProfile,
  saveState,
  routeConversation,
}) {
  const text = String(userText || '').trim();
  const currentProfile = state.profile || {};
  const currentMemory = state.memory || {};
  let labState = state.labState || null;

  const explicitProfile = parseExplicitProfileInput(text);
  let profile = currentProfile;
  if (Object.keys(explicitProfile).length) {
    profile = mergeProfile(currentProfile, explicitProfile);
    if (typeof saveProfile === 'function') await saveProfile(profile);
    if (explicitProfile.preferredName) {
      return { reply: `名前は「${explicitProfile.preferredName}」として覚えています。`, profile, state: { ...state, profile } };
    }
  }

  const profileAnswer = answerProfileQuestion(text, profile);
  if (profileAnswer) {
    return { reply: profileAnswer, profile, state: { ...state, profile } };
  }

  if (imageAnalysis && imageAnalysis.kind === 'lab') {
    const analysis = parseLabImageAnalysis(imageAnalysis);
    labState = makeLabSessionState(analysis);
    const nextState = { ...state, profile, labState };
    if (typeof saveState === 'function') await saveState(nextState);
    return { reply: buildDateListReply(analysis.panelDates), profile, state: nextState };
  }

  const labReply = handleLabFollowup(text, labState);
  if (labReply) {
    const nextLabState = {
      ...(labState || {}),
      selectedDate: labReply.selectedDate || (labState && labState.selectedDate),
      savedDates: labReply.savedDates || (labState && labState.savedDates) || [],
    };
    const nextState = { ...state, profile, labState: nextLabState };
    if (typeof saveState === 'function') await saveState(nextState);
    return { reply: labReply.reply, profile, state: nextState };
  }

  const guidanceContext = buildGuidanceContext({
    profile,
    memory: currentMemory,
    latestInput: text,
    labState,
    lastUserAt: state.lastUserAt,
  });

  const routed = await routeConversation({
    userText: text,
    generateReply,
    guidanceContext,
  });

  const nextState = { ...state, profile, labState };
  if (typeof saveState === 'function') await saveState(nextState);
  return {
    reply: routed,
    profile,
    state: nextState,
    guidanceContext,
  };
}

module.exports = {
  orchestrateConversation,
  buildGuidanceContext,
};
