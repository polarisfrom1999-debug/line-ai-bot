# PHASE14 GEMINI-FIRST LAB PIPELINE

## What changed
- Treat blood test images as documents first, chat answers second.
- Split single-day reports and multi-date timeseries at ingest.
- Ask Gemini for structured JSON, not free-text summaries.
- Keep normalized rows, dates, flags, and confidence in the in-memory panel.
- Improve web fallback so `/home` and `/chat` do not drop to hard 500 as easily.

## New services
- `services/lab_document_classifier_service.js`
- `services/lab_structured_extract_service.js`

## Main compatibility note
This package is built from the current GitHub state before phase13 was applied.
You can overwrite the current repo directly with this full package.
