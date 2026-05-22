'use strict';

const ushigomeConversationStyleService = require('./ushigome_conversation_style_service');
const movementGoalCompanionService = require('./movement_goal_companion_service');

function normalizeText(v) {
  return String(v || '').trim();
}

/**
 * 自然返信生成用のコンテキストを組み立てる。
 */
function buildReplyContext(params = {}) {
  const userText = normalizeText(params.userText || '');
  const conversationMode = normalizeText(params.conversationMode || params.intentType || '');
  const intent = normalizeText(params.intent || 'normal_chat');
  const featureResults = params.featureResults && typeof params.featureResults === 'object'
    ? params.featureResults
    : {};
  const userContext = params.userContext && typeof params.userContext === 'object'
    ? params.userContext
    : {};
  const observationHints = Array.isArray(params.observationHints) ? params.observationHints : [];
  const conversationUnderstanding = params.conversationUnderstanding && typeof params.conversationUnderstanding === 'object'
    ? params.conversationUnderstanding
    : null;
  const extractedDataCandidates = params.extractedDataCandidates && typeof params.extractedDataCandidates === 'object'
    ? params.extractedDataCandidates
    : null;
  const replyStrategy = params.replyStrategy && typeof params.replyStrategy === 'object'
    ? params.replyStrategy
    : null;
  const replyPolicy = {
    lineShort: params.replyPolicy?.lineShort !== false,
    avoidTemplate: params.replyPolicy?.avoidTemplate !== false,
    numberFormatOnly: params.replyPolicy?.numberFormatOnly !== false,
    replyDepth: normalizeText(params.replyDepth || params.replyPolicy?.replyDepth || 'normal'),
    ...(params.replyPolicy || {}),
  };

  const ushigomeStyle = params.ushigomeStyle && typeof params.ushigomeStyle === 'object'
    ? params.ushigomeStyle
    : ushigomeConversationStyleService.buildUshigomeStyleHints({
      userText,
      conversationMode,
      intentType: intent,
      featureResults,
      userContext,
    });

  const useMovementHints =
    conversationMode === 'movement_goal_companion'
    || movementGoalCompanionService.isMovementGoalCompanionText(userText);

  const movementGoalHints = params.movementGoalHints && typeof params.movementGoalHints === 'object'
    ? params.movementGoalHints
    : useMovementHints
      ? movementGoalCompanionService.buildMovementGoalHints({
        userText,
        conversationMode,
        userContext,
      })
      : null;

  return {
    userText,
    conversationMode,
    intent,
    featureResults,
    userContext: {
      relationshipPhase: normalizeText(userContext.relationshipPhase || ''),
      recentPatternHints: Array.isArray(userContext.recentPatternHints) ? userContext.recentPatternHints : [],
      stableRoutineEvidenceCount: Number(userContext.stableRoutineEvidenceCount || 0),
      recentMessages: Array.isArray(userContext.recentMessages) ? userContext.recentMessages : [],
      longMemory: userContext.longMemory || {},
    },
    observationHints,
    replyPolicy,
    ushigomeStyle,
    movementGoalHints,
    conversationUnderstanding,
    extractedDataCandidates,
    replyStrategy,
  };
}

module.exports = {
  buildReplyContext,
};
