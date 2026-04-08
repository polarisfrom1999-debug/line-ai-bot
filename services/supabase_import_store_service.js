'use strict';

/**
 * supabase_import_store_service.js
 *
 * phase15_gemini_import_core.sql を流した前提の store 実装。
 * 既存テーブルを壊さず additive に載せる。
 */

function unwrapSingle(result, message) {
  if (result.error) throw new Error(result.error.message || message);
  return result.data;
}

function createSupabaseImportStore(supabase) {
  if (!supabase) throw new Error('supabase is required');

  return {
    async createSession({ domain, userId, sourceType, mediaCount, sessionMeta }) {
      const res = await supabase
        .from('gemini_import_sessions')
        .insert({
          domain,
          user_id: userId,
          source_type: sourceType,
          media_count: mediaCount,
          status: 'processing',
          session_meta: sessionMeta || {},
        })
        .select('id, domain, user_id')
        .single();
      return unwrapSingle(res, 'createSession failed');
    },

    async saveRawResult({ sessionId, userId, domain, schemaName, promptVersion, resultHash, rawPayload }) {
      const res = await supabase
        .from('gemini_import_raw_results')
        .insert({
          session_id: sessionId,
          user_id: userId,
          domain,
          schema_name: schemaName,
          prompt_version: promptVersion,
          result_hash: resultHash,
          raw_payload: rawPayload,
        })
        .select('id')
        .single();
      const row = unwrapSingle(res, 'saveRawResult failed');
      return row.id;
    },

    async saveNormalizedFacts({ sessionId, userId, domain, normalized, rawId }) {
      const facts = [];

      if (domain === 'lab') {
        for (const measurement of normalized?.measurements || []) {
          facts.push({
            session_id: sessionId,
            user_id: userId,
            domain,
            raw_result_id: rawId,
            fact_key: measurement.normalized_key,
            fact_date: measurement.date || null,
            fact_value_num: typeof measurement.value === 'number' ? measurement.value : Number(measurement.value),
            fact_unit: measurement.unit || null,
            fact_label: measurement.label || measurement.normalized_key,
            fact_payload: measurement,
          });
        }
      } else if (domain === 'meal') {
        for (const item of normalized?.items || []) {
          facts.push({
            session_id: sessionId,
            user_id: userId,
            domain,
            raw_result_id: rawId,
            fact_key: 'meal_item',
            fact_date: null,
            fact_value_num: item.kcal ?? null,
            fact_unit: 'kcal',
            fact_label: item.dish_name || 'meal_item',
            fact_payload: item,
          });
        }
      } else if (domain === 'movement') {
        const findings = normalized?.findings || {};
        for (const [key, value] of Object.entries(findings)) {
          facts.push({
            session_id: sessionId,
            user_id: userId,
            domain,
            raw_result_id: rawId,
            fact_key: key,
            fact_date: null,
            fact_value_num: null,
            fact_unit: null,
            fact_label: key,
            fact_payload: { value },
          });
        }
      }

      if (facts.length === 0) return [];
      const res = await supabase.from('gemini_import_facts').insert(facts);
      if (res.error) throw new Error(res.error.message || 'saveNormalizedFacts failed');
      return true;
    },

    async markSessionReady({ sessionId, summary }) {
      const res = await supabase
        .from('gemini_import_sessions')
        .update({ status: 'ready', summary: summary || null })
        .eq('id', sessionId);
      if (res.error) throw new Error(res.error.message || 'markSessionReady failed');
      return true;
    },
  };
}

module.exports = {
  createSupabaseImportStore,
};
