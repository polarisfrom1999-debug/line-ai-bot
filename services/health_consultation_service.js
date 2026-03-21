'use strict';

function normalizeText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function buildHealthConsultationGuide(text = '') {
  const t = normalizeText(text);

  const emergencyWords = [
    '救急', '緊急', '意識がない', '息苦しい', '呼吸できない', '胸が痛い', '胸痛', '激痛',
    'ろれつが回らない', '片麻痺', '倒れた', '失神', '吐血', '下血', 'けいれん', '痙攣',
    '骨折した', '出血が止まらない'
  ];

  const urgentWords = [
    '強い痛み', 'かなり痛い', '痛みが強い', '悪化', 'しびれ', '力が入らない', '動かせない',
    '長引いている', '何日も痛い', '数日続く', '発熱', '熱がある', '腫れがひどい'
  ];

  if (emergencyWords.some((word) => t.includes(normalizeText(word)))) {
    return '強い症状があるようなら、無理せず早めに救急や医療機関へ相談してください。';
  }

  if (urgentWords.some((word) => t.includes(normalizeText(word)))) {
    return '強い痛みや長引く症状がある時は、無理を広げず早めに医療機関へ相談してください。';
  }

  return '';
}

module.exports = {
  buildHealthConsultationGuide,
};
