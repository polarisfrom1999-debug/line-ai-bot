'use strict';

/**
 * services/admin_memo_service.js
 *
 * 目的:
 * - 管理者向け共有メモを共通フォーマットで作る
 * - 既存の flow を壊さず、あとから index.js に安全に接続できる形にする
 * - 痛み相談 / 血液検査 / 記録漏れ / 週間報告 / 月間報告 に対応
 */

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round1(value) {
  const n = toNumber(value, null);
  return n === null ? null : Math.round(n * 10) / 10;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function formatDateLabel(value) {
  const s = safeText(value);
  if (!s) return '';
  const m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function normalizeSeverity(value) {
  const s = safeText(value).toLowerCase();
  if (s === 'urgent') return 'urgent';
  if (s === 'moderate') return 'moderate';
  return 'mild';
}

function severityLabel(severity) {
  switch (normalizeSeverity(severity)) {
    case 'urgent':
      return '高';
    case 'moderate':
      return '中';
    default:
      return '低';
  }
}

function pickRecommendedTimingBySeverity(severity) {
  switch (normalizeSeverity(severity)) {
    case 'urgent':
      return 'できるだけ早めに確認';
    case 'moderate':
      return '1〜2日以内に確認';
    default:
      return '2〜3日後に軽く確認';
  }
}

function cleanList(values, limit = 5) {
  return uniq((values || []).map((v) => safeText(v)).filter(Boolean)).slice(0, limit);
}

function buildBaseMemo(input = {}) {
  return {
    memo_type: safeText(input.memo_type || 'general'),
    user_id: safeText(input.user_id || ''),
    user_name: safeText(input.user_name || ''),
    created_at: safeText(input.created_at || new Date().toISOString()),
    report_period: safeText(input.report_period || ''),
    severity: normalizeSeverity(input.severity || 'mild'),
    priority_label: severityLabel(input.severity || 'mild'),
  };
}

function buildPainMemo(input = {}) {
  const base = buildBaseMemo({
    ...input,
    memo_type: 'pain',
    severity: input.severity || 'mild',
  });

  const bodyPart = safeText(input.body_part || input.primary_part || '');
  const symptom = safeText(input.symptom || input.primary_symptom || '');
  const mechanisms = cleanList(input.mechanisms || input.trigger_keywords || []);
  const redFlags = cleanList(input.red_flags || []);
  const hints = cleanList(input.hints || input.condition_hints || []);
  const followupQuestions = cleanList(input.followup_questions || [], 3);
  const selfCareAdvice = cleanList(input.self_care_advice || [], 3);

  const summaryParts = [];
  if (bodyPart) summaryParts.push(bodyPart);
  if (symptom) summaryParts.push(symptom);
  if (mechanisms.length) summaryParts.push(`きっかけ: ${mechanisms.join(' / ')}`);

  return {
    ...base,
    category: '症状相談',
    title: `${safeText(input.user_name || '利用者')}さん 痛み相談メモ`,
    summary: summaryParts.join(' / ') || '痛み相談メモ',
    chief_complaint: safeText(input.chief_complaint || input.original_text || ''),
    body_part: bodyPart || null,
    symptom: symptom || null,
    mechanisms,
    red_flags: redFlags,
    hints,
    followup_questions: followupQuestions,
    self_care_advice: selfCareAdvice,
    recommended_followup_timing: pickRecommendedTimingBySeverity(base.severity),
    recommended_action:
      base.severity === 'urgent'
        ? '早めに状態確認。必要時は受診案内を優先。'
        : base.severity === 'moderate'
          ? '無理を避ける案内を継続し、短期で再確認。'
          : '数日後に軽く経過確認。',
  };
}

function summarizeLabValues(lab = {}) {
  const pairs = [];

  if (lab.hba1c !== undefined && lab.hba1c !== null) pairs.push(`HbA1c ${lab.hba1c}`);
  if (lab.fasting_glucose !== undefined && lab.fasting_glucose !== null) pairs.push(`血糖 ${lab.fasting_glucose}`);
  if (lab.ast !== undefined && lab.ast !== null) pairs.push(`AST ${lab.ast}`);
  if (lab.alt !== undefined && lab.alt !== null) pairs.push(`ALT ${lab.alt}`);
  if (lab.gamma_gt !== undefined && lab.gamma_gt !== null) pairs.push(`γ-GTP ${lab.gamma_gt}`);
  if (lab.ldl_cholesterol !== undefined && lab.ldl_cholesterol !== null) pairs.push(`LDL ${lab.ldl_cholesterol}`);
  if (lab.hdl_cholesterol !== undefined && lab.hdl_cholesterol !== null) pairs.push(`HDL ${lab.hdl_cholesterol}`);
  if (lab.triglycerides !== undefined && lab.triglycerides !== null) pairs.push(`中性脂肪 ${lab.triglycerides}`);
  if (lab.uric_acid !== undefined && lab.uric_acid !== null) pairs.push(`尿酸 ${lab.uric_acid}`);
  if (lab.creatinine !== undefined && lab.creatinine !== null) pairs.push(`Cr ${lab.creatinine}`);

  return pairs.slice(0, 8);
}

function buildLabMemo(input = {}) {
  const base = buildBaseMemo({
    ...input,
    memo_type: 'lab_result',
    severity: input.severity || 'mild',
  });

  const latestLab = input.latest_lab_result || input.lab_result || {};
  const importantFindings = cleanList(input.important_findings || []);
  const cautionPoints = cleanList(input.caution_points || []);
  const summaryPairs = summarizeLabValues(latestLab);

  return {
    ...base,
    category: '血液検査',
    title: `${safeText(input.user_name || '利用者')}さん 血液検査メモ`,
    summary: summaryPairs.join(' / ') || '血液検査データあり',
    exam_date: safeText(latestLab.exam_date || latestLab.date || ''),
    latest_values: latestLab,
    important_findings: importantFindings,
    caution_points: cautionPoints,
    recommended_followup_timing:
      safeText(input.recommended_followup_timing) || '次回対応時に確認',
    recommended_action:
      safeText(input.recommended_action) ||
      '必要に応じて生活習慣・既往・症状と合わせて確認。',
  };
}

function buildMissingLogMemo(input = {}) {
  const base = buildBaseMemo({
    ...input,
    memo_type: 'missing_log',
    severity: input.severity || 'mild',
  });

  const missingItems = cleanList(input.missing_items || []);
  const lastReportDate = safeText(input.last_report_date || '');
  const daysSinceLastReport = toNumber(input.days_since_last_report, null);

  let severity = base.severity;
  if (daysSinceLastReport !== null) {
    if (daysSinceLastReport >= 7) severity = 'moderate';
    if (daysSinceLastReport >= 14) severity = 'urgent';
  }

  return {
    ...base,
    severity,
    priority_label: severityLabel(severity),
    category: '記録漏れ',
    title: `${safeText(input.user_name || '利用者')}さん 記録漏れメモ`,
    summary:
      missingItems.length
        ? `未報告: ${missingItems.join(' / ')}`
        : '記録漏れフォローが必要',
    last_report_date: lastReportDate || null,
    days_since_last_report: daysSinceLastReport,
    missing_items: missingItems,
    recommended_followup_timing:
      severity === 'urgent'
        ? '早めに再開しやすい声かけ'
        : severity === 'moderate'
          ? '1〜2日以内にやさしく確認'
          : '自然なタイミングで軽く促し',
    recommended_action:
      severity === 'urgent'
        ? '責めずに再開しやすい一言を優先。'
        : severity === 'moderate'
          ? '短くやさしく再開導線を送る。'
          : '状況に合わせて軽くフォロー。',
  };
}

function buildReportMemo(input = {}) {
  const base = buildBaseMemo({
    ...input,
    memo_type: input.report_type === 'monthly' ? 'monthly_report' : 'weekly_report',
    severity: 'mild',
  });

  const reportType = safeText(input.report_type || 'weekly');
  const highlights = cleanList(input.highlights || [], 5);
  const nextActions = cleanList(input.next_actions || [], 5);
  const reviewPoints = cleanList(
    input.review_points || [
      '数字に不自然さがないか',
      '強すぎる表現になっていないか',
      '症状がある場合に無理な提案になっていないか',
      '利用者さんに合う柔らかさか',
    ],
    6
  );

  return {
    ...base,
    category: reportType === 'monthly' ? '月間報告' : '週間報告',
    title: `${safeText(input.user_name || '利用者')}さん ${reportType === 'monthly' ? '月間' : '週間'}報告確認メモ`,
    summary: safeText(input.summary_text || '報告下書き確認用メモ'),
    report_type: reportType,
    report_period: safeText(input.report_period || ''),
    highlights,
    next_actions: nextActions,
    draft_text: safeText(input.draft_text || ''),
    review_points: reviewPoints,
    recommended_followup_timing: '確認後に送信',
    recommended_action:
      reportType === 'monthly'
        ? '全体トーンと来月の方向性を確認してから送信。'
        : '軽めの励ましを添えて送信。',
  };
}

function buildGeneralMemo(input = {}) {
  const base = buildBaseMemo(input);

  return {
    ...base,
    category: safeText(input.category || '一般'),
    title: safeText(input.title || `${safeText(input.user_name || '利用者')}さん 共有メモ`),
    summary: safeText(input.summary || ''),
    detail: safeText(input.detail || ''),
    recommended_followup_timing:
      safeText(input.recommended_followup_timing) || pickRecommendedTimingBySeverity(base.severity),
    recommended_action: safeText(input.recommended_action || ''),
  };
}

function memoToText(memo = {}) {
  const lines = [];

  lines.push(`【${safeText(memo.category || '共有メモ')}】`);
  if (memo.title) lines.push(`件名: ${memo.title}`);
  if (memo.user_name) lines.push(`利用者: ${memo.user_name}`);
  if (memo.report_period) lines.push(`期間: ${memo.report_period}`);
  if (memo.created_at) lines.push(`作成日時: ${safeText(memo.created_at)}`);
  if (memo.priority_label) lines.push(`優先度: ${memo.priority_label}`);
  if (memo.summary) lines.push(`要点: ${memo.summary}`);

  if (memo.chief_complaint) lines.push(`主訴: ${memo.chief_complaint}`);
  if (memo.body_part) lines.push(`部位: ${memo.body_part}`);
  if (memo.symptom) lines.push(`症状: ${memo.symptom}`);
  if (Array.isArray(memo.mechanisms) && memo.mechanisms.length) {
    lines.push(`きっかけ: ${memo.mechanisms.join(' / ')}`);
  }
  if (Array.isArray(memo.red_flags) && memo.red_flags.length) {
    lines.push(`注意所見: ${memo.red_flags.join(' / ')}`);
  }
  if (Array.isArray(memo.hints) && memo.hints.length) {
    lines.push(`補足: ${memo.hints.join(' / ')}`);
  }

  if (memo.exam_date) lines.push(`検査日: ${formatDateLabel(memo.exam_date)}`);
  if (Array.isArray(memo.important_findings) && memo.important_findings.length) {
    lines.push(`重要所見: ${memo.important_findings.join(' / ')}`);
  }
  if (Array.isArray(memo.caution_points) && memo.caution_points.length) {
    lines.push(`確認点: ${memo.caution_points.join(' / ')}`);
  }

  if (memo.last_report_date) lines.push(`最終報告日: ${formatDateLabel(memo.last_report_date)}`);
  if (memo.days_since_last_report !== null && memo.days_since_last_report !== undefined) {
    lines.push(`未報告日数: ${memo.days_since_last_report}日`);
  }
  if (Array.isArray(memo.missing_items) && memo.missing_items.length) {
    lines.push(`未報告項目: ${memo.missing_items.join(' / ')}`);
  }

  if (Array.isArray(memo.highlights) && memo.highlights.length) {
    lines.push(`良い点: ${memo.highlights.join(' / ')}`);
  }
  if (Array.isArray(memo.next_actions) && memo.next_actions.length) {
    lines.push(`次の一歩: ${memo.next_actions.join(' / ')}`);
  }

  if (Array.isArray(memo.review_points) && memo.review_points.length) {
    lines.push(`確認項目: ${memo.review_points.join(' / ')}`);
  }

  if (memo.recommended_followup_timing) {
    lines.push(`確認目安: ${memo.recommended_followup_timing}`);
  }
  if (memo.recommended_action) {
    lines.push(`対応案: ${memo.recommended_action}`);
  }

  return lines.filter(Boolean).join('\n');
}

function createPainAdminMemo(input = {}) {
  const memo = buildPainMemo(input);
  return {
    ok: true,
    memo_type: 'pain',
    memo,
    memo_text: memoToText(memo),
  };
}

function createLabAdminMemo(input = {}) {
  const memo = buildLabMemo(input);
  return {
    ok: true,
    memo_type: 'lab_result',
    memo,
    memo_text: memoToText(memo),
  };
}

function createMissingLogAdminMemo(input = {}) {
  const memo = buildMissingLogMemo(input);
  return {
    ok: true,
    memo_type: 'missing_log',
    memo,
    memo_text: memoToText(memo),
  };
}

function createReportAdminMemo(input = {}) {
  const memo = buildReportMemo(input);
  return {
    ok: true,
    memo_type: memo.memo_type,
    memo,
    memo_text: memoToText(memo),
  };
}

function createGeneralAdminMemo(input = {}) {
  const memo = buildGeneralMemo(input);
  return {
    ok: true,
    memo_type: memo.memo_type,
    memo,
    memo_text: memoToText(memo),
  };
}

module.exports = {
  createPainAdminMemo,
  createLabAdminMemo,
  createMissingLogAdminMemo,
  createReportAdminMemo,
  createGeneralAdminMemo,
  memoToText,
};
