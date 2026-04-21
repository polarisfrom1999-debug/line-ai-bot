'use strict';

const fs = require('fs');
const path = require('path');
const labImageV1 = require('../services/lab_image_analysis_service');
const labImageV2 = require('../services/lab_image_analysis_v2_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function listImageFiles(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs)
    .map((name) => path.join(abs, name))
    .filter((p) => /\.(png|jpg|jpeg|webp)$/i.test(p));
}

function summarize(panel = {}) {
  return {
    isLabImage: Boolean(panel?.isLabImage || panel?.labLike),
    patientName: normalizeText(panel?.patientName || ''),
    facilityName: normalizeText(panel?.facilityName || ''),
    printDate: normalizeText(panel?.printDate || ''),
    latestExamDate: normalizeText(panel?.latestExamDate || panel?.examDate || ''),
    examDates: Array.isArray(panel?.examDates) ? panel.examDates : [],
    items: Array.isArray(panel?.items) ? panel.items.map((x) => normalizeText(x?.itemName || '')).filter(Boolean) : [],
    structuredItemCount: Array.isArray(panel?.itemsStructured) ? panel.itemsStructured.length : 0,
  };
}

async function runOne(filePath) {
  const buffer = fs.readFileSync(filePath);
  const imagePayload = {
    ok: true,
    buffer,
    mimeType: /\.png$/i.test(filePath) ? 'image/png' : 'image/jpeg',
    id: path.basename(filePath)
  };
  const [v1, v2] = await Promise.all([
    labImageV1.analyzeLabImage(imagePayload),
    labImageV2.analyzeLabImageV2(imagePayload, { sourceImageId: path.basename(filePath) })
  ]);
  return {
    file: path.basename(filePath),
    v1: summarize(v1),
    v2: summarize(v2),
  };
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/lab_pipeline_regression_compare.js <image_dir>');
    process.exit(1);
  }
  const files = listImageFiles(dir);
  if (!files.length) {
    console.error(`no image files found: ${dir}`);
    process.exit(1);
  }
  const out = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop
    const row = await runOne(file);
    out.push(row);
    console.log(`[compare] ${row.file} v1(items=${row.v1.items.length}) v2(items=${row.v2.items.length}, structured=${row.v2.structuredItemCount})`);
  }
  const report = {
    generatedAt: new Date().toISOString(),
    total: out.length,
    rows: out
  };
  const outPath = path.resolve(process.cwd(), 'tmp_lab_pipeline_compare_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`report saved: ${outPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
