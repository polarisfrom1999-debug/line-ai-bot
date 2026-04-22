# Phase E: Deprecation and Rollback Playbook

## 1) Reachability logging tags

Old routes:
- `[phasee-old] old_image_ingress_reached`
- `[phasee-old] old_followup_reached`
- `[phasee-old] old_local_parser_reached`
- `[phasee-old] old_reject_first_path`
- `[phasee-old] old_meal_correction_reached`

New routes:
- `[phasee-new] new_image_ingress_reached`
- `[phasee-new] new_followup_router_reached`
- `[phasee-new] canonical_meal_reached`
- `[phasee-new] canonical_lab_reached`
- `[phasee-new] response_guard_reached`

## 2) Deletion candidate policy

Do NOT delete immediately. Candidate order is fixed:
1. old reject-first branches
2. old local parser fallback path
3. old follow-up router path
4. old meal correction path
5. old image ingress path

Promotion to deletion candidate requires:
- zero reachability count for 14 consecutive days in production logs
- no rollback event during same window
- one dry-run release on staging with old flags hard-off

Before deletion, publish candidate list:
- route tag
- last_seen_at
- zero_count_days
- affected files

## 3) Rollback procedure

Immediate rollback flags:
- `ENABLE_NEW_FLOW_IMAGE_INGEST=0`
- `ENABLE_NEW_FLOW_IMAGE_FOLLOWUP=0`
- `ENABLE_NEW_FLOW_GENERAL_FOLLOWUP=0`
- `ENABLE_NEW_FLOW_RESPONSE_GUARD=0` (optional emergency only)

Validation after rollback:
1. Send image message and confirm old image ingress log appears.
2. Send text follow-up and confirm old follow-up log appears.
3. Confirm no `[phasee-new] new_image_ingress_reached` in the same test window.

## 4) Operational checklist

- Daily: monitor old/new route counts by tag.
- Weekly: verify old route counts trending to zero.
- Before code deletion: attach 14-day zero-count evidence.

## 5) Daily aggregation fields

Daily aggregation source: `phasee_route_reachability_daily`

Required fields:
- `tag`
- `day` (`day_ymd`)
- `count`
- `last_seen` (`last_seen_at`)
- `zero_day_count` (computed by daily report)
- `files`

Run:
- `npm run ops:phasee-daily-report`

## 6) Migration apply and verification steps

1. Apply migration SQL once:
   - `sql/phasee_route_reachability_daily.sql`
   - Apply in Supabase SQL Editor (or your DB migration pipeline).
2. Verify migration (read-only):
   - `npm run ops:phasee-verify-migration`
3. Optional write verification:
   - PowerShell: `$env:PHASEE_VERIFY_WRITE='1'; npm run ops:phasee-verify-migration`
   - This inserts a one-off marker row to confirm write access.

## 7) Daily operation playbook

1. Ensure app is running with reachability tags enabled.
2. Run daily report:
   - `npm run ops:phasee-daily-report`
3. Archive report output to operations log storage.
4. Review fields per tag:
   - `tag`
   - `day`
   - `count`
   - `last_seen`
   - `zero_day_count`
   - `files`
5. Only when `zero_day_count >= 14`, mark route as deletion candidate.
6. Do not delete code in the same day as candidate marking; require review approval.
