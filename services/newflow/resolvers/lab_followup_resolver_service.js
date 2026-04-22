'use strict';

const labFollowupService = require('../../lab_followup_service');
const responseBuilderService = require('../response_builder_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function buildAvailableScopePrefix(panel = {}) {
  const bits = [];
  const patient = normalizeText(panel?.patientName || '');
  const facility = normalizeText(panel?.facilityName || '');
  const printDate = normalizeText(panel?.printDate || '');
  if (patient) bits.push(`患者名: ${patient}`);
  if (facility) bits.push(`医療機関: ${facility}`);
  if (printDate) bits.push(`印刷日: ${printDate}`);
  return bits.length ? `今確認できる範囲では、${bits.join(' / ')}です。` : '今確認できる範囲でお答えします。';
}

function buildTrendReply(panel = {}) {
  const items = Array.isArray(panel?.items) ? panel.items : [];
  const trendLines = [];
  for (const it of items) {
    const history = Array.isArray(it?.history) ? it.history.filter((h) => normalizeText(h?.value || '')) : [];
    if (history.length < 2) continue;
    const latest = normalizeText(history[history.length - 1]?.value || '');
    const prev = normalizeText(history[history.length - 2]?.value || '');
    if (!latest || !prev || latest === prev) continue;
    const name = normalizeText(it?.itemName || '');
    if (!name) continue;
    trendLines.push(`${name}: ${prev} → ${latest}`);
    if (trendLines.length >= 3) break;
  }
  if (!trendLines.length) return `${buildAvailableScopePrefix(panel)} 変化はまだ十分に追えないため、比較したい項目名を指定してください。`;
  return `${buildAvailableScopePrefix(panel)} 変化が確認できる項目は ${trendLines.join(' / ')} です。`;
}

function resolveLabFollowup(text, panel) {
  const safeText = normalizeText(text || '');
  if (!safeText || !panel || typeof panel !== 'object') return null;

  if (/患者名|氏名/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: `${buildAvailableScopePrefix(panel)} ${labFollowupService.buildPatientNameReply(panel)}` };
  if (/病院名|医院名|クリニック名|医療機関/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: `${buildAvailableScopePrefix(panel)} ${labFollowupService.buildFacilityNameReply(panel)}` };
  if (/印刷日|発行日|出力日/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: `${buildAvailableScopePrefix(panel)} ${labFollowupService.buildPrintDateReply(panel)}` };
  if (/日付|検査日|採血日|一番新しい日付|最新日/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: labFollowupService.buildExamDateQuickReply(panel) };
  if (/異常がついている項目|異常項目|H\/L|ハイフラグ|ローフラグ|悪い値/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: `${buildAvailableScopePrefix(panel)} ${labFollowupService.buildAbnormalItemsReply(panel)}` };
  if (/変化|推移|上がった|下がった/.test(safeText)) return { intentType: 'newflow_lab_followup', replyText: buildTrendReply(panel) };
  if (/わかるのは|何の項目|読み取れた項目|数値で読め|他に何が|他に読め|検査項目は|他の項目で確認出来たのは|他の検査結果で読めたのは|検査結果でわかるのある|この結果どう見える|異常ありそう|変化/.test(safeText)) {
    return { intentType: 'newflow_lab_followup', replyText: `${buildAvailableScopePrefix(panel)} ${labFollowupService.buildReadableInventoryReply(panel)}` };
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
  return { intentType: 'newflow_lab_followup', replyText: `${buildAvailableScopePrefix(panel)} ${responseBuilderService.buildLabGenericReply()}` };
}

module.exports = {
  resolveLabFollowup,
};
