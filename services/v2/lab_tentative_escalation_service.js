'use strict';

const labItemAliasService = require('../lab_item_alias_service');

function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * 血液検査画像の「tentative lab / lab_image_pending」への昇格条件（弱いシグナル）。
 * isLabImage / labLike が立っていないが、次のいずれかがあればセッション作成・routeKind=lab に載せる。
 *
 * - print_date: 印刷日・発行日相当のフィールドが埋まっている
 * - raw_text_length: OCR テキストが十分長い（ノイズでもフォローアップ用に保持）
 * - raw_text_lab_lexicon: 短いテキストでも検査語彙が含まれる
 * - table_like_raw: 改行・表記ゆれから表形式っぽいレイアウトを推定
 * - table_like_rows: 構造化抽出の行数が複数（v2 の行ベースシグナル）
 * - exam_dates: 検査日候補が1件以上
 * - patient_name_fragment / facility_name_fragment: 氏名・施設名の断片
 * - candidate_item_names: 項目名だけ拾えている（数値なしの items / itemsStructured 含む）
 * - raw_numeric_item_map: 生テキストから数値付き項目マップが取れた
 */
function hasLabLexiconHint(rawText) {
  return /血液|検査|採血|検体|結果通知|成分|脂質|糖代謝|肝機能|腎機能|血球|受付日|印刷|氏名|基準値|上限|下限|単位|mg\/dL|U\/L|g\/dL|LDL|HDL|HbA1c|AST|ALT|TG|中性脂肪/i.test(
    normalizeText(rawText)
  );
}

function hasTableLikeLayout(rawText) {
  const t = normalizeText(rawText);
  if (t.length < 24) return false;
  const tabs = (t.match(/\t/g) || []).length;
  if (tabs >= 3) return true;
  const lines = t.split(/\r?\n/).filter((x) => normalizeText(x).length > 0);
  if (lines.length >= 4 && /\d/.test(t) && /(検査|測定|基準|単位|mg|U\/L|dL)/i.test(t)) return true;
  if (/(項目|検査名|結果|参考|単位)/.test(t) && lines.length >= 3 && /\d/.test(t)) return true;
  return false;
}

function getStructuredRowCount(lab) {
  const n = Number(lab?.analysisConfidence?.rows);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function countCandidateItemNameEntries(lab) {
  let n = 0;
  const items = Array.isArray(lab?.items) ? lab.items : [];
  for (const it of items) {
    if (normalizeText(it?.itemName || it?.name || '')) n += 1;
  }
  const structured = Array.isArray(lab?.itemsStructured) ? lab.itemsStructured : [];
  for (const block of structured) {
    if (normalizeText(block?.name_original || block?.name_normalized || '')) n += 1;
  }
  return n;
}

function getTentativePromotionSignals(lab) {
  const reasons = [];
  if (!lab || typeof lab !== 'object') return { reasons };
  if (lab.isLabImage || lab.labLike) return { reasons };

  if (normalizeText(lab.printDate || lab.print_date || '')) reasons.push('print_date');

  const raw = normalizeText(lab.rawText || '');
  if (raw.length >= 20) reasons.push('raw_text_length');
  else if (raw.length >= 6 && hasLabLexiconHint(raw)) reasons.push('raw_text_lab_lexicon');

  if (hasTableLikeLayout(raw)) reasons.push('table_like_raw');
  if (getStructuredRowCount(lab) >= 2) reasons.push('table_like_rows');

  if (Array.isArray(lab.examDates) && lab.examDates.length) reasons.push('exam_dates');

  if (normalizeText(lab.patientName || lab.patient_name || '')) reasons.push('patient_name_fragment');
  if (normalizeText(lab.facilityName || lab.facility_name || '')) reasons.push('facility_name_fragment');

  if (countCandidateItemNameEntries(lab) > 0) reasons.push('candidate_item_names');

  const mapKeys = Object.keys(labItemAliasService.buildLabItemMapFromRawText(raw) || {});
  if (mapKeys.length) reasons.push('raw_numeric_item_map');

  return { reasons };
}

function shouldAcceptTentativeLabSession(lab) {
  if (!lab || typeof lab !== 'object') return false;
  if (lab.isLabImage || lab.labLike) return true;
  return getTentativePromotionSignals(lab).reasons.length > 0;
}

module.exports = {
  getTentativePromotionSignals,
  shouldAcceptTentativeLabSession,
  hasLabLexiconHint,
  hasTableLikeLayout,
  getStructuredRowCount,
  countCandidateItemNameEntries,
};
