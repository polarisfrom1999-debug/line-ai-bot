'use strict';

const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} = require('docx');

const ROOT = path.resolve(__dirname, '..');
const INPUT_MD = path.join(ROOT, 'docs', 'kokokara_user_manual.md');
const OUTPUT_DOCX = path.join(ROOT, 'docs', 'kokokara_user_manual_print.docx');

function normalizeLine(line) {
  return String(line || '').replace(/\r/g, '').trimEnd();
}

function parseMarkdownToParagraphs(markdown) {
  const lines = String(markdown || '').split('\n').map(normalizeLine);
  const out = [];
  let inNumbered = false;
  let number = 0;

  const pushBlank = () => {
    out.push(new Paragraph({ children: [new TextRun('')] }));
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      inNumbered = false;
      pushBlank();
      continue;
    }
    if (/^---+$/.test(line)) {
      inNumbered = false;
      out.push(
        new Paragraph({
          border: { bottom: { color: 'D9D9D9', space: 1, value: 'single', size: 6 } }
        })
      );
      continue;
    }
    if (line.startsWith('# ')) {
      inNumbered = false;
      out.push(
        new Paragraph({
          heading: HeadingLevel.TITLE,
          spacing: { after: 240 },
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: line.slice(2).trim(), bold: true })]
        })
      );
      continue;
    }
    if (line.startsWith('## ')) {
      inNumbered = false;
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 160, after: 120 },
          children: [new TextRun({ text: line.slice(3).trim(), bold: true })]
        })
      );
      continue;
    }
    if (line.startsWith('### ')) {
      inNumbered = false;
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 120, after: 80 },
          children: [new TextRun({ text: line.slice(4).trim(), bold: true })]
        })
      );
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (!inNumbered) {
        inNumbered = true;
        number = 1;
      } else {
        number += 1;
      }
      const body = line.replace(/^\d+\.\s+/, '');
      out.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: `${number}. ${body}` })]
        })
      );
      continue;
    }
    if (line.startsWith('- ')) {
      inNumbered = false;
      const body = line.slice(2).trim();
      out.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: `・${body}` })]
        })
      );
      continue;
    }

    inNumbered = false;
    out.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: line.replace(/\s{2,}$/g, '') })]
      })
    );
  }
  return out;
}

async function main() {
  if (!fs.existsSync(INPUT_MD)) {
    throw new Error(`manual markdown not found: ${INPUT_MD}`);
  }

  const markdown = fs.readFileSync(INPUT_MD, 'utf8');
  const bodyParagraphs = parseMarkdownToParagraphs(markdown);
  const generatedAt = new Date();

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          ...bodyParagraphs,
          new Paragraph({ children: [new TextRun('')] }),
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `生成日時: ${generatedAt.toISOString()}`,
                italics: true,
                size: 18,
                color: '666666'
              })
            ]
          })
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUTPUT_DOCX, buffer);
  console.log(`Wordマニュアルを出力しました: ${OUTPUT_DOCX}`);
}

main().catch((error) => {
  console.error('[generate_word_manual] failed:', error?.message || error);
  process.exit(1);
});
