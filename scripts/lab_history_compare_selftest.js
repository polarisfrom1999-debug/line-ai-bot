'use strict';

const lab = require('../services/lab_history_compare_service');

const s1 = {
  id: 2,
  print_date: '2024-01-10',
  exam_dates_json: [],
  parsed_items_json: [
    { normalizedKey: 'triglycerides_tg', name: '中性脂肪', value: '120', unit: 'mg/dL', flag: '' },
    { normalizedKey: 'ldl_cholesterol', name: 'LDL', value: '100', unit: 'mg/dL', flag: '' }
  ],
  created_at: '2024-01-12T00:00:00Z'
};
const s2 = {
  id: 3,
  print_date: '2025-03-24',
  exam_dates_json: [],
  parsed_items_json: [
    { normalizedKey: 'triglycerides_tg', name: '中性脂肪', value: '61', unit: 'mg/dL', flag: '' },
    { normalizedKey: 'ldl_cholesterol', name: 'LDL', value: '151', unit: 'mg/dL', flag: 'H' }
  ],
  created_at: '2025-03-25T00:00:00Z'
};

const arr = [s1, s2];
const comp = lab.summarizeMultisessionComparisons(arr);
const picked = lab.pickOverallLines(comp);
const ser = lab.getTgSeries(arr);
const tgc = lab.compareKeySeries('alias:tg', ser);
const w = lab.findWorseningToHigh(arr);
if (picked.length < 1) throw new Error('pick fail');
if (!tgc || !tgc.canCompare) throw new Error('tg compare fail');
if (w.length < 1) throw new Error('worsen fail');
console.log('lab_history_compare_selftest: ok', { pickedN: picked.length, tgDir: tgc.direction, wN: w.length });
