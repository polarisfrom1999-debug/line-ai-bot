'use strict';

function buildMovementAnalysisHint({ latestInput = '' } = {}) {
  const text = String(latestInput || '');
  if (!/動画|静止画|フォーム|走り|投球|ジャンプ|着地|姿勢|左右差/.test(text)) return null;

  return {
    title: '動作解析の見方',
    shortText: '正面・横・後ろのどこから見たか、痛みの有無、気になる動きの瞬間があると整理しやすいです。',
    guidanceHint: '画像や動画の相談は、左右差・接地・骨盤・体幹・腕振りなどを仮説として整理し、医学的断定は避けます。',
  };
}

module.exports = { buildMovementAnalysisHint };
