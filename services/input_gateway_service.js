'use strict';

const classifier = require('./input_classifier_service');
const webLinkCommandService = require('./web_link_command_service');
const movementAnalysisService = require('./movement_analysis_service');
const movementSessionService = require('./movement_session_service');

function normalizeText(value) {
  return String(value || '').trim();
}

async function handleLineTopLevel(input = {}) {
  const lane = classifier.classifyInputLane(input);

  if (lane === 'web_link') {
    const issued = await webLinkCommandService.buildWebLinkReplyByLineUser(input.lineUserId || input.userId);
    return {
      handled: true,
      lane,
      replyMessages: [{ type: 'text', text: issued.replyText }],
      internal: issued.internal
    };
  }

  if (lane === 'movement_video_media') {
    const registered = await movementSessionService.registerMovementVideo(input.lineUserId || input.userId, input);
    const replyText = movementSessionService.buildMovementVideoReply(registered);
    return {
      handled: true,
      lane,
      replyMessages: [{
        type: 'text',
        text: replyText || [
          '動画は受け取りました。',
          movementAnalysisService.buildRunningVideoGuidance()
        ].filter(Boolean).join('\n')
      }],
      internal: {
        intentType: 'movement_video_received',
        responseMode: 'guided',
        entryLane: lane,
        movementSessionId: registered?.session?.sessionId || '',
        movementClipCount: Array.isArray(registered?.session?.clips) ? registered.session.clips.length : 0
      }
    };
  }

  if (lane === 'movement_image_media' || lane === 'shoe_wear_image_media') {
    return {
      handled: false,
      lane,
      internal: {
        entryLane: lane,
        intentType: lane
      }
    };
  }

  return {
    handled: false,
    lane,
    internal: {
      entryLane: lane,
      normalizedText: normalizeText(input.rawText || '')
    }
  };
}

module.exports = {
  handleLineTopLevel
};
