# Stage Entry manual deploy steps

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
