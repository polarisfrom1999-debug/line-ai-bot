# Gemini Interface Contract (Phase 0 Fixed)

## Canonical dispatch entry

`services/gemini_dispatch_service.js`

### `generateStructuredImageJson(args)`

- **Input**
  - `imagePayload`
  - `prompt`
  - `schema`
  - `domain` (optional)
  - `model` (optional)
  - `temperature` (optional)
  - `maxOutputTokens` (optional)
- **Output success**
  - `{ ok: true, json, text, model, raw, domain }`
- **Output failure**
  - `{ ok: false, json: {}, text: '', model: null, raw: null, domain, error: { code, message } }`
- **Error behavior**
  - Must not throw. Caller handles by `ok` flag.

### Lower-level helpers

- `generateJsonFromImage(args)` -> throws on failure
- `generateTextFromImage(args)` -> throws on failure
- `dispatchGemini(args)` -> compatibility wrapper

## Core client/runtime layer

`services/gemini_service.js`

- `generateContentJson(...)`
- `generateContentText(...)`
- model fallback/retry and parsing support are implemented here.

## Usage rule

1. Structured image extraction must call `generateStructuredImageJson`.
2. Non-structured image text extraction may call `generateTextFromImage`.
3. Direct calls to internal model clients from business services are prohibited.
