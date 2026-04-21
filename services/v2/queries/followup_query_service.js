'use strict';

const activeContextResolver = require('../active_context_resolver_service');
const activeContextService = require('../../active_context_service');
const labFollowupService = require('../../lab_followup_service');
const sessionStateRepository = require('../../../repositories/session_state_repository');
const labSessionRepository = require('../../../repositories/lab_session_repository');
const mealFollowupResolverService = require('../followups/meal_followup_resolver_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildLatestLabPanel(shortMemory = {}) {
  return shortMemory?.activeContext?.payload?.labPanel
    || shortMemory?.followUpContext?.labPanel
    || null;
}

function buildPanelFromPersistedSessions(activeSession = null, labSession = null) {
  const activePanel = activeSession?.payload?.labPanel;
  if (activePanel && typeof activePanel === 'object') return activePanel;
  if (!labSession || typeof labSession !== 'object') return null;
  return {
    patientName: normalizeText(labSession.patient_name || ''),
    facilityName: normalizeText(labSession.facility_name || ''),
    printDate: normalizeText(labSession.print_date || ''),
    examDates: Array.isArray(labSession.exam_dates_json) ? labSession.exam_dates_json : [],
    items: Array.isArray(labSession.parsed_items_json) ? labSession.parsed_items_json : [],
    rawText: normalizeText(labSession.raw_text || ''),
    latestExamDate: Array.isArray(labSession.exam_dates_json) && labSession.exam_dates_json.length
      ? String(labSession.exam_dates_json[labSession.exam_dates_json.length - 1] || '')
      : '',
  };
}

async function resolveFollowupV2({ input, text, shortMemory = {} }) {
  const safe = normalizeText(text || input?.rawText || '');
  if (!safe || input?.messageType !== 'text') return null;

  const active = await activeContextService.getActiveContext(input.userId, shortMemory).catch(() => null);
  const mealReply = await mealFollowupResolverService.resolveMealFollowupFromSession({
    input,
    text: safe,
    activeContext: active
  });
  if (mealReply?.replyText) return mealReply;

  const activeReply = await activeContextResolver.resolveActiveContextFollowup({ input, text: safe, shortMemory });
  if (activeReply?.replyText) return activeReply;

  const panel = buildLatestLabPanel(shortMemory);
  if (panel && /わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め/.test(safe)) {
    return {
      intentType: 'v2_lab_broad_followup',
      replyText: labFollowupService.buildReadableInventoryReply(panel)
    };
  }

  const persistedActive = await sessionStateRepository.getLatestActiveSessionByTypes(input.userId, ['lab_followup_session', 'lab_image_session']);
  const persistedLab = await labSessionRepository.getLatestLabSession(input.userId);
  const persistedPanel = buildPanelFromPersistedSessions(persistedActive, persistedLab);
  if (persistedPanel && /患者名|氏名|病院名|医院名|クリニック名|医療機関|印刷日|日付|検査日|採血日|TG|LDL|HDL|HbA1c|わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め/.test(safe)) {
    if (/患者名|氏名/.test(safe)) return { intentType: 'v2_lab_followup_l2', replyText: labFollowupService.buildPatientNameReply(persistedPanel) };
    if (/病院名|医院名|クリニック名|医療機関/.test(safe)) return { intentType: 'v2_lab_followup_l2', replyText: labFollowupService.buildFacilityNameReply(persistedPanel) };
    if (/印刷日/.test(safe)) return { intentType: 'v2_lab_followup_l2', replyText: labFollowupService.buildPrintDateReply(persistedPanel) };
    if (/日付|検査日|採血日/.test(safe)) return { intentType: 'v2_lab_followup_l2', replyText: labFollowupService.buildExamDateQuickReply(persistedPanel) };
    if (/わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め/.test(safe)) return { intentType: 'v2_lab_followup_l2', replyText: labFollowupService.buildReadableInventoryReply(persistedPanel) };
    const target = labFollowupService.normalizeTarget(safe);
    if (target) return { intentType: 'v2_lab_followup_l2', replyText: labFollowupService.buildItemReply(persistedPanel, target, persistedPanel?.latestExamDate || '') };
  }
  return null;
}

module.exports = {
  resolveFollowupV2,
};
