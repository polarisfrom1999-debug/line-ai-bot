# Stage Entry rollback quick guide

## fastest full rollback
- USE_NEW_ORCHESTRATOR=0

## stage-only rollback
- ENABLE_GUIDANCE_HOMECARE_ENTRY=0
- ENABLE_GUIDANCE_SPORTS_ENTRY=0
- ENABLE_GUIDANCE_COMPETITION_ENTRY=0
- ENABLE_GUIDANCE_SYMPTOM_ENTRY=0
- ENABLE_GUIDANCE_GENERAL=0
- ENABLE_GUIDANCE_SUMMARY_VIEW=0
- ENABLE_GUIDANCE_PERSONA=0
- ENABLE_STAGE_ENTRY_GUIDANCE=0

## rollback now if
- webhook 401
- 二重返信
- handled なのに無反応
- 56.8kg がガイド扱い
- グラフ出して がガイド扱い
- 右膝の内側が3日前から痛い が入口help扱い
