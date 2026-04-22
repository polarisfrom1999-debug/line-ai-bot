'use strict';

module.exports = {
  routes: [
    { tag: 'old_image_ingress_reached', files: ['services/v2/image_ingress_v2_service.js'] },
    { tag: 'old_followup_reached', files: ['services/v2/queries/followup_query_service.js'] },
    { tag: 'old_local_parser_reached', files: ['services/lab_structured_extract_service.js'] },
    { tag: 'old_reject_first_path', files: ['services/v2/image_ingress_v2_service.js', 'services/v2/queries/followup_query_service.js'] },
    { tag: 'old_meal_correction_reached', files: ['services/v2/followups/meal_followup_resolver_service.js'] },
    { tag: 'new_image_ingress_reached', files: ['services/newflow/image_ingest_orchestrator_service.js'] },
    { tag: 'new_followup_router_reached', files: ['services/newflow/followup_router_service.js'] },
    { tag: 'canonical_meal_reached', files: ['services/newflow/canonical_fallback_service.js'] },
    { tag: 'canonical_lab_reached', files: ['services/newflow/canonical_fallback_service.js'] },
    { tag: 'response_guard_reached', files: ['services/newflow/response_guard_service.js'] },
  ],
  zeroCandidateDays: 14,
};
