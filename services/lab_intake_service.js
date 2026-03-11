'use strict';

/**
 * 血液検査のAI抽出結果を正規化し、
 * pending session に載せるための配列化と、
 * 一括保存を行うサービス
 */

const {
  normalizeRows,
} = require('../blood_test_flow_helpers');

/**
 * AI出力を rows[] に正規化する
 * 想定入力:
 * - { rows: [...] }
 * - { results: [...] }
 * - 単体オブジェクト
 */
function extractLabRowsFromAiPayload(aiPayload = {}) {
  if (!aiPayload || typeof aiPayload !== 'object') return [];

  if (Array.isArray(aiPayload.rows)) {
    return normalizeRows(aiPayload.rows);
  }

  if (Array.isArray(aiPayload.results)) {
    return normalizeRows(aiPayload.results);
  }

  // 日付キーごとの辞書っぽい場合
  // 例: { "2025-01-10": {...}, "2024-12-01": {...} }
  const objectKeys = Object.keys(aiPayload);
  const possibleDateMapRows = [];

  for (const key of objectKeys) {
    if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(key)) {
      const value = aiPayload[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        possibleDateMapRows.push({
          exam_date: key,
          ...value,
        });
      }
    }
  }

  if (possibleDateMapRows.length) {
    return normalizeRows(possibleDateMapRows);
  }

  // 単体オブジェクト
  return normalizeRows([aiPayload]);
}

/**
 * DBに入れるカラムのみ残す
 */
function sanitizeInsertRow(row, extra = {}) {
  return {
    user_id: extra.user_id,
    exam_date: row.exam_date,

    height: row.height ?? null,
    weight: row.weight ?? null,
    bmi: row.bmi ?? null,
    abdominal_circumference: row.abdominal_circumference ?? null,

    systolic_bp: row.systolic_bp ?? null,
    diastolic_bp: row.diastolic_bp ?? null,

    ast: row.ast ?? null,
    alt: row.alt ?? null,
    gamma_gtp: row.gamma_gtp ?? null,

    triglyceride: row.triglyceride ?? null,
    hdl: row.hdl ?? null,
    ldl: row.ldl ?? null,

    fasting_glucose: row.fasting_glucose ?? null,
    hba1c: row.hba1c ?? null,
    uric_acid: row.uric_acid ?? null,
    creatinine: row.creatinine ?? null,

    hemoglobin: row.hemoglobin ?? null,
    hematocrit: row.hematocrit ?? null,
    rbc: row.rbc ?? null,
    wbc: row.wbc ?? null,

    total_protein: row.total_protein ?? null,
    albumin: row.albumin ?? null,
    bun: row.bun ?? null,
    egfr: row.egfr ?? null,

    source_image_url: extra.source_image_url || null,
    import_session_id: extra.import_session_id || null,
    is_user_confirmed: extra.is_user_confirmed ?? true,
    ai_summary: extra.ai_summary || null,
  };
}

/**
 * 同一 user_id + exam_date の既存データがあれば更新、なければinsert
 * 既存スキーマ差異で upsert が不安定な場合に備え、1件ずつ安全に処理
 */
async function upsertLabResultByUserAndDate(supabase, row) {
  const { data: existing, error: selectError } = await supabase
    .from('lab_results')
    .select('id')
    .eq('user_id', row.user_id)
    .eq('exam_date', row.exam_date)
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from('lab_results')
      .update(row)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return { mode: 'update', row: data };
  }

  const { data, error } = await supabase
    .from('lab_results')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return { mode: 'insert', row: data };
}

/**
 * 一括保存
 */
async function savePendingLabRows({
  supabase,
  userId,
  rows,
  importSessionId = null,
  sourceImageUrl = null,
  aiSummary = null,
}) {
  if (!supabase) {
    throw new Error('supabase client is required');
  }

  if (!userId) {
    throw new Error('userId is required');
  }

  const normalized = normalizeRows(rows || []);
  if (!normalized.length) {
    throw new Error('保存対象の血液検査データがありません');
  }

  const results = [];

  for (const row of normalized) {
    const insertRow = sanitizeInsertRow(row, {
      user_id: userId,
      import_session_id: importSessionId,
      source_image_url: sourceImageUrl,
      ai_summary: aiSummary,
      is_user_confirmed: true,
    });

    const saved = await upsertLabResultByUserAndDate(supabase, insertRow);
    results.push(saved);
  }

  return {
    ok: true,
    count: results.length,
    results,
  };
}

module.exports = {
  extractLabRowsFromAiPayload,
  savePendingLabRows,
};
