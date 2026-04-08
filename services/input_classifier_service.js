'use strict';

const webLinkCommandService = require('./web_link_command_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function classifyTextIntent(text) {
  const safe = normalizeText(text);
  if (!safe) return 'empty';
  if (webLinkCommandService.isWebLinkCommand(safe)) return 'web_link';
  if (/血液検査|採血|LDL|HDL|HbA1c|中性脂肪|TG|AST|ALT|γ-GTP|クレアチニン|eGFR/i.test(safe)) return 'lab_question';
  if (/走り.*動画|動画.*見てほしい|フォーム.*動画|靴.*減り|靴底|アキレス腱|フォーム改善|股関節.*可動域|可動域.*広げ/i.test(safe)) return 'sports_question';
  if (/食事|ごはん|朝食|昼食|夕食|カロリー|食べた|飲んだ/i.test(safe)) return 'meal_question';
  return 'chat';
}

function classifyMediaLane(input = {}) {
  const messageType = normalizeText(input.messageType || '');
  const rawText = normalizeText(input.rawText || '');
  if (messageType === 'video') return 'movement_video_media';
  if (messageType === 'image') {
    if (/靴|靴底|ソール|削れ|摩耗/i.test(rawText)) return 'shoe_wear_image_media';
    if (/フォーム|走り|動画|アキレス腱|接地|足の運び/i.test(rawText)) return 'movement_image_media';
    if (/血液検査|採血|LDL|HDL|HbA1c|中性脂肪|TG|AST|ALT|γ-GTP/i.test(rawText)) return 'lab_image_media';
    if (/食事|ごはん|朝食|昼食|夕食|カロリー/i.test(rawText)) return 'meal_image_media';
    return 'generic_image_media';
  }
  if (messageType === 'file') return 'file_media';
  return 'none';
}

function classifyInputLane(input = {}) {
  const messageType = normalizeText(input.messageType || '');
  if (messageType === 'text') return classifyTextIntent(input.rawText || '');
  const mediaLane = classifyMediaLane(input);
  return mediaLane === 'none' ? 'chat' : mediaLane;
}

module.exports = {
  classifyInputLane,
  classifyTextIntent,
  classifyMediaLane
};
