'use strict';

/**
 * services/chat_capture_service.js
 *
 * 役割:
 * - 会話文から「伴走に必要な意味」を候補として抽出する
 * - 記録候補 / 短期記憶候補 / 長期記憶候補 / 感情シグナル / 相談シグナル を分離
 * - ここでは保存も返答生成もしない
 */

function normalizeText(value) {
  return String(value || '').trim();
}

function pushUnique(list, value) {
  const safeValue = normalizeText(value);
  if (!safeValue) return;
  if (!list.includes(safeValue)) list.push(safeValue);
}

function detectRecordCandidates(text) {
  const records = [];

  if (/\b\d{2,3}(\.\d)?\s?kg\b|体重|体脂肪/.test(text)) {
    records.push({
      recordType: 'weight',
      source: 'text',
      certainty: /今朝|今日|kg/.test(text) ? 'high' : 'medium',
      rawText: text,
      needsConfirmation: /昨日|たぶん|くらい/.test(text)
    });
  }

  if (/歩い|ジョギング|走っ|筋トレ|ストレッチ|運動/.test(text)) {
    records.push({
      recordType: 'exercise',
      source: 'text',
      certainty: /分|km|キロ|歩いた|した/.test(text) ? 'high' : 'medium',
      rawText: text,
      needsConfirmation: /予定|つもり/.test(text)
    });
  }

  if (/食べた|朝ごはん|昼ごはん|夜ごはん|朝ご飯|昼ご飯|夜ご飯|朝食|昼食|夕食|ごはん|鍋|パン|卵|サラダ/.test(text)) {
    records.push({
      recordType: 'meal',
      source: 'text',
      certainty: /食べた|朝|昼|夜/.test(text) ? 'high' : 'medium',
      rawText: text,
      needsConfirmation: /予定|つもり|半分|少し|軽め|くらい/.test(text)
    });
  }

  if (/LDL|HDL|中性脂肪|AST|ALT|血液検査|HbA1c/i.test(text)) {
    records.push({
      recordType: 'lab',
      source: 'text',
      certainty: /\d/.test(text) ? 'high' : 'medium',
      rawText: text,
      needsConfirmation: false
    });
  }

  return records;
}

function detectEmotionalSignals(text, result) {
  if (/つらい|苦しい|落ち込|最悪|無理|限界/.test(text)) pushUnique(result.emotionalSignals, 'heavy_negative');
  if (/不安|焦る|怖い|心配/.test(text)) pushUnique(result.emotionalSignals, 'anxious');
  if (/疲れた|眠い|寝不足|だるい|余裕ない|バタバタ/.test(text)) pushUnique(result.emotionalSignals, 'fatigued');
  if (/安心|落ち着|ほっとした|助かった/.test(text)) pushUnique(result.emotionalSignals, 'calming');
}

function detectConsultationSignals(text, result) {
  if (/どうしたら|できない|悩|困って/.test(text)) pushUnique(result.consultationSignals, 'needs_guidance');
  if (/停滞|増えた|減らない/.test(text)) pushUnique(result.consultationSignals, 'plateau');
  if (/むくみ|便通|水分/.test(text)) pushUnique(result.consultationSignals, 'body_balance');
  if (/痛み|痛い|骨折|首|腰|膝/.test(text)) pushUnique(result.consultationSignals, 'pain_context');
  if (/夜遅|リズム|乱れ/.test(text)) pushUnique(result.consultationSignals, 'rhythm_disturbance');
}

function detectShortMemoryCandidates(text, result) {
  if (/疲れた|眠い|寝不足|だるい|余裕ない/.test(text)) pushUnique(result.shortMemoryCandidates, '今日は疲れが強そう');
  if (/不安|焦る|落ち込/.test(text)) pushUnique(result.shortMemoryCandidates, '今日は不安が強そう');
  if (/痛い|骨折|首|腰|膝/.test(text)) pushUnique(result.shortMemoryCandidates, '今日は身体負担が強そう');
  if (/天気|寒い|暑い|花粉/.test(text)) pushUnique(result.shortMemoryCandidates, '最近の雑談テーマ:天気');
}

function detectLongMemoryCandidates(text, result) {
  if (/夜遅/.test(text)) pushUnique(result.longMemoryCandidates, '夜遅い食事になりやすい');
  if (/むくみ/.test(text)) pushUnique(result.longMemoryCandidates, 'むくみを気にしやすい');
  if (/便通/.test(text)) pushUnique(result.longMemoryCandidates, '便通で不安になりやすい');
  if (/水分/.test(text)) pushUnique(result.longMemoryCandidates, '水分バランスを気にしやすい');
  if (/痛い|骨折|首|腰|膝/.test(text)) pushUnique(result.longMemoryCandidates, '痛みがあると運動が止まりやすい');
  if (/家族|子ども|育児/.test(text)) pushUnique(result.longMemoryCandidates, '家族都合で生活リズムが揺れやすい');
  if (/仕事|残業|夜勤/.test(text)) pushUnique(result.longMemoryCandidates, '仕事都合で生活リズムが揺れやすい');
  if (/優しく|やわらかく|きつく言わないで/.test(text)) pushUnique(result.longMemoryCandidates, '優しく整理されると受け取りやすい');
  if (/理屈で|理由が知りたい/.test(text)) pushUnique(result.longMemoryCandidates, '理屈で整理されると受け取りやすい');
  if (/隠して|隠しがち|言いにくい/.test(text)) pushUnique(result.longMemoryCandidates, '隠しやすさがある');
  if (/頑張りすぎ|無理しがち/.test(text)) pushUnique(result.longMemoryCandidates, '頑張りすぎやすい');
}

function detectSupportHints(text, result) {
  if (/つらい|苦しい|疲れた|眠い/.test(text)) pushUnique(result.supportHints, '安心感優先');
  if (/どうしたら|悩/.test(text)) pushUnique(result.supportHints, '提案は1つまで');
  if (/短く|一言で/.test(text)) pushUnique(result.supportHints, '短く返す');
}

async function extractFromConversation(context) {
  const text = normalizeText(context?.input?.rawText);
  const result = {
    recordCandidates: [],
    shortMemoryCandidates: [],
    longMemoryCandidates: [],
    emotionalSignals: [],
    consultationSignals: [],
    supportHints: []
  };

  if (!text) {
    if (context?.input?.messageType === 'image') {
      pushUnique(result.shortMemoryCandidates, '画像入力あり');
    }
    return result;
  }

  result.recordCandidates = detectRecordCandidates(text);
  detectEmotionalSignals(text, result);
  detectConsultationSignals(text, result);
  detectShortMemoryCandidates(text, result);
  detectLongMemoryCandidates(text, result);
  detectSupportHints(text, result);

  return result;
}

module.exports = {
  extractFromConversation,
  detectRecordCandidates
};
