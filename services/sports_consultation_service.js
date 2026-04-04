"use strict";

const { buildRunningVideoGuidance, buildStillImageGuidance } = require('./movement_analysis_service');

function normalizeText(value) {
  return String(value || '').trim();
}

function detectSportsIntent(text) {
  const safe = normalizeText(text);
  if (!safe) return null;
  if (/走り.*動画|動画.*見てほしい|フォーム.*動画/.test(safe)) return 'movement_video';
  if (/フォーム.*改善|走り.*改善|投げ方.*改善|打ち方.*改善/.test(safe)) return 'form_improvement';
  if (/股関節.*可動域|可動域.*広げ/.test(safe)) return 'mobility';
  if (/リハビリ|復帰|怪我.*相談/.test(safe)) return 'rehab';
  if (/栄養|食事|補食|女性特有|月経|貧血/.test(safe) && /スポーツ|大会|練習|走/.test(safe)) return 'sports_nutrition';
  return null;
}

function buildSportsReply(intent) {
  switch (intent) {
    case 'movement_video':
      return buildRunningVideoGuidance();
    case 'form_improvement':
      return [
        'フォーム改善は、今の困りごとを1つに絞ると進めやすいです。',
        'たとえば「接地で沈む」「腕振りがぶれる」「上体が反る」みたいに、気になる点を1つ教えてください。',
        '動画や静止画があれば、そこから優先順位を一緒に決めます。'
      ].join('\n');
    case 'mobility':
      return [
        '股関節の可動域を広げたい時は、まず痛みの有無を分けて考えるのが大事です。',
        '痛みがなければ、内転筋・お尻・股関節前面をゆるめる流れから始めやすいです。',
        '必要なら、無理の少ない1〜2種目に絞ってメニューを提案します。'
      ].join('\n');
    case 'rehab':
      return [
        '怪我後の相談は、まず「受診済みか」「今どこまで動けるか」を土台にすると安全です。',
        '診断名があればそのまま、なければ痛みの場所・動きでつらい場面・腫れやしびれの有無を教えてください。',
        '断定診断はしませんが、復帰段階の整理と無理の少ない進め方は一緒に考えられます。'
      ].join('\n');
    case 'sports_nutrition':
      return [
        'スポーツの食事相談は、種目・練習時間・困りごとが分かると合わせやすいです。',
        'たとえば「800mで、朝練前の補食を知りたい」「女性で貧血が心配」みたいに送ってもらえれば大丈夫です。'
      ].join('\n');
    default:
      return buildStillImageGuidance();
  }
}

module.exports = {
  detectSportsIntent,
  buildSportsReply,
};
