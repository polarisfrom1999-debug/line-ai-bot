'use strict';

/**
 * services/profile_service.js
 *
 * 役割:
 * - 会話から人物理解に使う情報を整える
 */

function extractProfileCandidates(text) {
  const safe = String(text || '').trim();
  const candidates = [];

  if (/うっし|呼んで|名前/.test(safe)) candidates.push('呼び方の希望がある');
  if (/無理なく|痩せたい|体重を落としたい/.test(safe)) candidates.push('無理なく体重を落としたい');
  if (/優しく|やわらかく/.test(safe)) candidates.push('優しく整理されると受け取りやすい');
  if (/理屈で|理由が知りたい/.test(safe)) candidates.push('理屈で整理されると受け取りやすい');
  if (/頑張りすぎ|無理しがち/.test(safe)) candidates.push('頑張りすぎやすい');
  if (/隠しがち|言いにくい/.test(safe)) candidates.push('隠しやすさがある');
  if (/家族|育児/.test(safe)) candidates.push('家族都合で生活リズムが揺れやすい');
  if (/仕事|残業|夜勤/.test(safe)) candidates.push('仕事都合で生活リズムが揺れやすい');

  return [...new Set(candidates)];
}

module.exports = {
  extractProfileCandidates
};
