services/weight_service.js
'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function toHalfWidth(text) {
  return normalizeText(text).replace(/[０-９．]/g, (s) => {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  });
}

function extractWeightValue(text) {
  const safe =
