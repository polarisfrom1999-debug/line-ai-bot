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
