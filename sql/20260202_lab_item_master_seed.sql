-- lab_item_master 主要項目（再実行可: ON CONFLICT 更新）
-- Supabase: 20260202_lab_result_canonical_schema.sql の後に実行

INSERT INTO lab_item_master (normalized_key, display_name_ja, display_name_en, aliases_json, category, default_unit, sort_order)
VALUES
  ('triglycerides_tg', '中性脂肪', 'TG', '["中性脂肪","TG","tg","triglyceride","triglycerides","トリグリセリド","トリグリ"]'::jsonb, 'lipid', 'mg/dL', 10),
  ('total_cholesterol', '総コレステロール', 'T-CHO', '["総コレステロール","T-CHO","total cholesterol","総コレ"]'::jsonb, 'lipid', 'mg/dL', 11),
  ('hdl_cholesterol', 'HDLコレステロール', 'HDL-C', '["HDLコレステロール","HDL-C","HDL","hdl"]'::jsonb, 'lipid', 'mg/dL', 12),
  ('ldl_cholesterol', 'LDLコレステロール', 'LDL-C', '["LDLコレステロール","LDL-C","LDL","ldl"]'::jsonb, 'lipid', 'mg/dL', 13),
  ('glucose', '血糖', 'GLU', '["血糖","血糖値","glucose","GLU","glu","Bs"]'::jsonb, 'glucose', 'mg/dL', 20),
  ('hba1c', 'HbA1c', 'HbA1c', '["HbA1c","HbA1c(NGSP)","A1c","糖化ヘモグロビン"]'::jsonb, 'glucose', '%', 21),
  ('ast_got', 'AST', 'AST', '["AST","GOT","ast"]'::jsonb, 'liver', 'U/L', 30),
  ('alt_gpt', 'ALT', 'ALT', '["ALT","GPT","alt"]'::jsonb, 'liver', 'U/L', 31),
  ('ggt', 'γ-GTP', 'GGT', '["γ-GTP","γGTP","GGT","ggt"]'::jsonb, 'liver', 'U/L', 32),
  ('ldh', 'LDH', 'LDH', '["LDH","ldh"]'::jsonb, 'liver', 'U/L', 33),
  ('total_protein', '総蛋白', 'TP', '["総蛋白","TP","total protein"]'::jsonb, 'protein', 'g/dL', 40),
  ('albumin', 'アルブミン', 'Alb', '["アルブミン","Alb","ALB"]'::jsonb, 'protein', 'g/dL', 41),
  ('creatinine', 'クレアチニン', 'Cre', '["クレアチニン","Cre","Cr","CRE","creatinine"]'::jsonb, 'renal', 'mg/dL', 50),
  ('bun', '尿素窒素', 'BUN', '["尿素窒素","BUN","尿素"]'::jsonb, 'renal', 'mg/dL', 51),
  ('egfr', 'eGFR', 'eGFR', '["eGFR","egfr"]'::jsonb, 'renal', 'mL/min/1.73m2', 52),
  ('uric_acid', '尿酸', 'UA', '["尿酸","UA","ua"]'::jsonb, 'renal', 'mg/dL', 53),
  ('wbc', '白血球数', 'WBC', '["白血球","白血球数","WBC","wbc"]'::jsonb, 'cbc', '/μL', 60),
  ('rbc', '赤血球数', 'RBC', '["赤血球","赤血球数","RBC"]'::jsonb, 'cbc', '万/μL', 61),
  ('hemoglobin', 'ヘモグロビン', 'Hb', '["ヘモグロビン","Hb","HGB","血色素量"]'::jsonb, 'cbc', 'g/dL', 62),
  ('hematocrit', 'ヘマトクリット', 'Ht', '["ヘマトクリット","Ht","HCT"]'::jsonb, 'cbc', '%', 63),
  ('platelet', '血小板数', 'PLT', '["血小板","血小板数","PLT"]'::jsonb, 'cbc', '万/μL', 64),
  ('mcv', 'MCV', 'MCV', '["MCV","mcv"]'::jsonb, 'cbc', 'fL', 65),
  ('mch', 'MCH', 'MCH', '["MCH","mch"]'::jsonb, 'cbc', 'pg', 66),
  ('mchc', 'MCHC', 'MCHC', '["MCHC","mchc"]'::jsonb, 'cbc', '%', 67),
  ('crp', 'CRP', 'CRP', '["CRP","C反応性蛋白","クレアチン蛋白"]'::jsonb, 'inflammation', 'mg/dL', 70),
  ('cpk', 'CPK', 'CK', '["CPK","CK","クレアチンリンキン酵素"]'::jsonb, 'muscle', 'U/L', 71),
  ('na', 'Na', 'Na', '["Na","ナトリウム","血清ナトリウム"]'::jsonb, 'electrolyte', 'mEq/L', 80),
  ('k', 'K', 'K', '["K","カリウム","血清カリウム"]'::jsonb, 'electrolyte', 'mEq/L', 81),
  ('cl', 'Cl', 'Cl', '["Cl","クロール","血清クロール"]'::jsonb, 'electrolyte', 'mEq/L', 82),
  ('ca', 'Ca', 'Ca', '["Ca","カルシウム","血清カルシウム"]'::jsonb, 'electrolyte', 'mg/dL', 83)
ON CONFLICT (normalized_key) DO UPDATE SET
  display_name_ja = EXCLUDED.display_name_ja,
  aliases_json = EXCLUDED.aliases_json,
  category = EXCLUDED.category,
  default_unit = EXCLUDED.default_unit,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
