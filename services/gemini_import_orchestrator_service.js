'use strict';

/**
 * gemini_import_orchestrator_service.js
 *
 * 目的:
 * - 食事 / 血液検査 / 運動解析の Gemini-first 骨格を共通化する。
 * - 既存本流を壊さないよう、入力ドメインごとの prompt builder と
 *   thin-normalizer を差し替えられる設計にする。
 *
 * 前提:
 * - geminiRunner.runStructured({ prompt, attachments, schemaName }) が使えること
 * - store 層は supabase でも別 DB でも可
 */

const crypto = require('crypto');

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

async function createImportSession(store, payload) {
  return store.createSession({
    domain: payload.domain,
    userId: payload.userId,
    sourceType: payload.sourceType || 'line_media',
    mediaCount: Array.isArray(payload.attachments) ? payload.attachments.length : 0,
    sessionMeta: payload.sessionMeta || {},
  });
}

async function runDomainImport({
  userId,
  domain,
  attachments,
  promptBuilder,
  geminiRunner,
  store,
  thinNormalizer,
  sessionMeta,
}) {
  if (!userId) throw new Error('userId is required');
  if (!domain) throw new Error('domain is required');
  if (!Array.isArray(attachments) || attachments.length === 0) {
    throw new Error('attachments are required');
  }
  if (!promptBuilder || typeof promptBuilder.build !== 'function') {
    throw new Error('promptBuilder.build is required');
  }
  if (!geminiRunner || typeof geminiRunner.runStructured !== 'function') {
    throw new Error('geminiRunner.runStructured is required');
  }
  if (!store) throw new Error('store is required');

  const session = await createImportSession(store, {
    domain,
    userId,
    attachments,
    sessionMeta,
  });

  const built = await promptBuilder.build({ userId, attachments, sessionMeta, sessionId: session.id });
  const rawResult = await geminiRunner.runStructured({
    prompt: built.prompt,
    attachments,
    schemaName: built.schemaName,
  });

  const rawId = await store.saveRawResult({
    sessionId: session.id,
    userId,
    domain,
    schemaName: built.schemaName,
    promptVersion: built.promptVersion || 'v1',
    resultHash: sha256Text(JSON.stringify(rawResult || {})),
    rawPayload: rawResult,
  });

  let normalized = rawResult;
  if (thinNormalizer && typeof thinNormalizer.normalize === 'function') {
    normalized = await thinNormalizer.normalize({ raw: rawResult, sessionId: session.id, rawId, userId });
  }

  await store.saveNormalizedFacts({
    sessionId: session.id,
    userId,
    domain,
    normalized,
    rawId,
  });

  await store.markSessionReady({ sessionId: session.id, summary: normalized?.summary || null });

  return {
    sessionId: session.id,
    rawId,
    raw: rawResult,
    normalized,
  };
}

module.exports = {
  runDomainImport,
};
