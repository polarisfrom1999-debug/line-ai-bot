'use strict';

const path = require('path');
const sharp = require('sharp');

const w = 1200;
const h = 1600;
const lineEls = Array.from({ length: 50 }, (_, i) => {
  const y = i * 32;
  return `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#e0e0e0" stroke-width="1"/>`;
}).join('');
const svg = Buffer.from(
  `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    '<rect width="100%" height="100%" fill="white"/>' +
    lineEls +
    '<text x="60" y="100" font-size="28" fill="#111" font-family="sans-serif">血液一般検査</text>' +
    '<text x="60" y="200" font-size="20" fill="#333" font-family="sans-serif">Hb 14.3  g/dL</text>' +
    '<text x="60" y="250" font-size="20" fill="#333" font-family="sans-serif">TG 165   mg/dL  H</text>' +
    '<text x="60" y="300" font-size="18" fill="#555" font-family="sans-serif">受診日 2025-01-10</text>' +
    '</svg>'
);
const out = path.join(__dirname, '..', 'fixtures', 'lab_e2e_synthetic.jpg');

sharp(svg)
  .jpeg({ quality: 88 })
  .toFile(out)
  .then(() => {
    console.log('wrote', out);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
