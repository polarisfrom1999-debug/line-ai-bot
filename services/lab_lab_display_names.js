'use strict';

/** Gemini normalized_key → 表示名（日本語ラベル） */
const KEY_TO_ITEM_NAME = {
  ast_got: 'AST',
  alt_gpt: 'ALT',
  gamma_gtp: 'γ-GTP',
  creatinine: 'クレアチニン',
  uric_acid: '尿酸',
  bun: '尿素窒素',
  glucose: '血糖',
  hba1c: 'HbA1c',
  triglycerides_tg: '中性脂肪',
  total_cholesterol: '総コレステロール',
  hdl_cholesterol: 'HDL',
  ldl_cholesterol: 'LDL',
  ldl_hdl_ratio: 'LDL/HDL比',
  sodium: 'ナトリウム',
  potassium: 'カリウム',
  chloride: 'クロール',
  egfr: 'eGFR',
  wbc: '白血球数',
  rbc: '赤血球数',
  hemoglobin: '血色素量',
  hematocrit: 'ヘマトクリット',
  mcv: 'MCV',
  mch: 'MCH',
  mchc: 'MCHC',
  platelets: '血小板数',
  cpk: 'CPK',
  ldh: 'LDH',
  total_protein: '総蛋白',
  bilirubin: '総ビリルビン',
  calcium: 'Ca'
};

module.exports = {
  KEY_TO_ITEM_NAME
};
