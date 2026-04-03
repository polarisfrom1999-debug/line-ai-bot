'use strict';

/**
 * services/conversation_orchestrator_service.js
 *
 * Phase 6 + WEB/LINE 共通相談骨格の最小導入。
 *
 * 想定:
 * - 上位から state/store を受け取る
 * - 既存保存処理は注入関数で呼ぶ
 * - 画像判定後の lab flow をここで優先制御
 */

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

  // 1. 明示プロフィール更新を先に処理
  const explicitProfile = parseExplicitProfileInput(text);
  let profile = currentProfile;
  if (Object.keys(explicitProfile).length) {
    profile = mergeProfile(currentProfile, explicitProfile);
    if (typeof saveProfile === 'function') await saveProfile(profile);
    if (explicitProfile.preferredName) {
      return { reply: `名前は「${explicitProfile.preferredName}」として覚えています。`, profile, state: { ...state, profile } };
    }
  }

  // 2. プロフィール質問は profile 優先
  const profileAnswer = answerProfileQuestion(text, profile);
  if (profileAnswer) {
    return { reply: profileAnswer, profile, state: { ...state, profile } };
  }

  // 3. 検査画像を受けた直後は lab session を生成
  if (imageAnalysis && imageAnalysis.kind === 'lab') {
    const analysis = parseLabImageAnalysis(imageAnalysis);
    labState = makeLabSessionState(analysis);
    const nextState = { ...state, profile, labState };
    if (typeof saveState === 'function') await saveState(nextState);
    return { reply: buildDateListReply(analysis.panelDates), profile, state: nextState };
  }

  // 4. lab follow-up を優先
  const labReply = handleLabFollowup(text, labState);
  if (labReply) {
    const nextLabState = { ...(labState || {}), selectedDate: labReply.selectedDate || (labState && labState.selectedDate) };
    const nextState = { ...state, profile, labState: nextLabState };
    if (typeof saveState === 'function') await saveState(nextState);
    return { reply: labReply.reply, profile, state: nextState };
  }

  // 5. guidanceContext を作って自然会話へ流す
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
