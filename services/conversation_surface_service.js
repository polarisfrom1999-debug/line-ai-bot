'use strict';

/**
 * 表（ユーザー向け自然文）レイヤー。
 * 裏処理で組んだ下書きを、会話として自然な短文に載せ替える（数値は保持）。
 */

const aiChatService = require('./ai_chat_service');

function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * 再設計: データ整合性が整うまで GPT 言い換えは停止（下書きそのまま）。
 * 会話改善を再開する場合のみ KOKOKARA_CONVERSATION_REWRITE=1 と
 * KOKOKARA_SURFACE_LAYER_ON=1 の両方を付与。KOKOKARA_SURFACE_LAYER_OFF=1 は常に無効。
 */
function isSurfacePolishEnabled() {
  if (!/^1|true|yes$/i.test(String(process.env.KOKOKARA_CONVERSATION_REWRITE || '').trim())) {
    return false;
  }
  if (/^1|true|yes$/i.test(String(process.env.KOKOKARA_SURFACE_LAYER_OFF || '').trim())) {
    return false;
  }
  return /^1|true|yes$/i.test(String(process.env.KOKOKARA_SURFACE_LAYER_ON || '').trim());
}

function hasOpenAiKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function shouldSkipPolish(draft, params = {}) {
  const safe = normalizeText(draft);
  if (!safe) return true;
  if (safe.length > 1400) return true;
  const intent = normalizeText(params.intentType || '');
  if (/^motion_|^shoe_|^motion_video|^motion_image/.test(intent) && safe.length > 480) return true;
  if (/名前\s*[:：]/.test(safe) && /身長\s*[:：]/.test(safe)) return true;
  if (/【/.test(safe) && /体質|アンケート/.test(safe) && /ボタン|選んで/.test(safe)) return true;
  return false;
}

async function polishDraftToSurface(params = {}) {
  const draft = normalizeText(params.draftReply || params.draft || '');
  if (!draft || !isSurfacePolishEnabled() || !hasOpenAiKey() || shouldSkipPolish(draft, params)) {
    return draft;
  }

  const polished = normalizeText(
    await aiChatService.generateNaturalResponse(params.userMessage || '', {
      intentType: normalizeText(params.intentType || 'surface'),
      responseMode: 'conversation_first',
      messageType: normalizeText(params.messageType || 'text'),
      recentMessages: Array.isArray(params.recentMessages) ? params.recentMessages : [],
      longMemory: params.longMemory || {},
      energyLevel: normalizeText(params.energyLevel || 'middle')
    }, {
      draftReply: draft,
      hasStructuredData: true
    })
  );

  if (!polished || polished.length < 6) return draft;
  return polished;
}

module.exports = {
  polishDraftToSurface,
  shouldSkipPolish,
  isSurfacePolishEnabled
};
