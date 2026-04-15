# Stage Entry manual deploy steps

## minimal startup env set (required 5)
- before first run, set these 5 vars:
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
  - `GEMINI_API_KEY`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- quick start:
  - copy `.env.example` to `.env`
  - fill the 5 required vars above
  - keep `PERSONA_ADJUSTMENT_LEVEL=medium` as default

## 0. deploy before enabling
- deploy with all stage-entry flags OFF
- run `npm run flags:stage-entry`
- confirm all flags are OFF

## 1. master gate only
- USE_NEW_ORCHESTRATOR=1
- ENABLE_STAGE_ENTRY_GUIDANCE=1
- keep others OFF
- deploy and confirm record / summary paths still behave normally

## 2. Stage 1
- ENABLE_GUIDANCE_GENERAL=1
- ENABLE_GUIDANCE_SUMMARY_VIEW=1
- ENABLE_GUIDANCE_PERSONA=1
- deploy
- run Stage 1 light tests

## 3. Stage 2
- ENABLE_GUIDANCE_SYMPTOM_ENTRY=1
- deploy
- run Stage 2 light tests

## 4. Stage 3
- ENABLE_GUIDANCE_HOMECARE_ENTRY=1
- ENABLE_GUIDANCE_SPORTS_ENTRY=1
- ENABLE_GUIDANCE_COMPETITION_ENTRY=1
- deploy
- run Stage 3 light tests

## rollback
- first set the last enabled flag group back to 0
- if unstable, set ENABLE_STAGE_ENTRY_GUIDANCE=0
- if still unstable, set USE_NEW_ORCHESTRATOR=0

## persona adjustment level (new)
- `PERSONA_ADJUSTMENT_LEVEL` で全返信の人格補正強度を切り替えできます。
- allowed: `low` / `medium` / `high`
- default: `medium`
- guide:
  - `low`: 既存文面をほぼそのまま返す（補正最小）
  - `medium`: 推奨。低energy時の情報量調整 + 安全寄り補正
  - `high`: 低energy時の圧縮を強める（短文寄り）
