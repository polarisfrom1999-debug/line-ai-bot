'use strict';

const classifier = require('./input_classifier_service');
const webLinkCommandService = require('./web_link_command_service');
const movementAnalysisService = require('./movement_analysis_service');

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
    return {
      handled: true,
      lane,
      replyMessages: [{
        type: 'text',
        text: [
          '動画は受け取りました。',
          '本筋版では「動画を受け取る入口」と「動画を解析する入口」を分けています。',
          '現段階では、まず 10〜15秒くらいの動画を 1本ずつ確認しやすい形に整えています。',
          movementAnalysisService.buildRunningVideoGuidance()
        ].join('\n')
      }],
      internal: {
        intentType: 'movement_video_received',
        responseMode: 'guided',
        entryLane: lane
      }
    };
  }

  if (lane === 'movement_image_media') {
    return {
      handled: false,
      lane,
      internal: {
        entryLane: lane,
        intentType: 'movement_image_media'
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
