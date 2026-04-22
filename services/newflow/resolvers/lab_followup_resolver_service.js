'use strict';

const labFollowupService = require('../../lab_followup_service');
const responseBuilderService = require('../response_builder_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function resolveLabFollowup(text, panel) {
  const safeText = normalizeText(text || '');
  if (!safeText || !panel || typeof panel !== 'object') return null;

  if (/患者名|氏名/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildPatientNameReply(panel) };
  if (/病院名|医院名|クリニック名|医療機関/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildFacilityNameReply(panel) };
  if (/印刷日|発行日|出力日/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildPrintDateReply(panel) };
  if (/日付|検査日|採血日|一番新しい日付|最新日/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildExamDateQuickReply(panel) };
  if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ|悪い値/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildAbnormalItemsReply(panel) };
  if (/わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め|検査項目は|他の項目で確認出来たのは|他の検査結果で読めたのは|検査結果でわかるのある|この結果どう見える|異常ありそう|変化/.test(safeText)) {
    return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildReadableInventoryReply(panel) };
  }
  const target = labFollowupService.normalizeTarget(safeText);
  if (target) {
    const selectedDate = panel?.latestExamDate || panel?.examDate || '';
    return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildItemReply(panel, target, selectedDate) };
  }
  if (/削除できた|削除した|消えた|できた/.test(safeText)) {
    return {
      intentType: 'newflow_lab_followup',
      replyText: 'この文脈は検査画像の確認です。削除操作は行っていません。検査項目名を指定して聞いてください。'
    };
  }
  return { intentType: 'newflow_lab_followup', replyText: responseBuilderService.buildLabGenericReply() };
}

module.exports = {
  resolveLabFollowup,
};
