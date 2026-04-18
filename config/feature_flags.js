'use strict';

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function envEnum(name, allowedValues, defaultValue) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  const normalized = String(raw).trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : defaultValue;
}

module.exports = {
  ENABLE_STAGE_ENTRY_GUIDANCE: envBool('ENABLE_STAGE_ENTRY_GUIDANCE', false),

  ENABLE_GUIDANCE_GENERAL: envBool('ENABLE_GUIDANCE_GENERAL', false),
  ENABLE_GUIDANCE_SUMMARY_VIEW: envBool('ENABLE_GUIDANCE_SUMMARY_VIEW', false),
  ENABLE_GUIDANCE_PERSONA: envBool('ENABLE_GUIDANCE_PERSONA', false),
  ENABLE_GUIDANCE_SYMPTOM_ENTRY: envBool('ENABLE_GUIDANCE_SYMPTOM_ENTRY', false),
  ENABLE_GUIDANCE_HOMECARE_ENTRY: envBool('ENABLE_GUIDANCE_HOMECARE_ENTRY', false),
  ENABLE_GUIDANCE_SPORTS_ENTRY: envBool('ENABLE_GUIDANCE_SPORTS_ENTRY', false),
  ENABLE_GUIDANCE_COMPETITION_ENTRY: envBool('ENABLE_GUIDANCE_COMPETITION_ENTRY', false),
  ENABLE_SYMPTOM_CORE: envBool('ENABLE_SYMPTOM_CORE', false),
  ENABLE_HOMECARE_CORE: envBool('ENABLE_HOMECARE_CORE', false),
  /** WEB の「伴走（陸上）」中1女子 800m/1500m 東京向けモード（Phase 1）。既定オフで既存利用者に影響しない */
  ENABLE_ATHLETE_SUPPORT_WEB: envBool('ENABLE_ATHLETE_SUPPORT_WEB', false),
  ENABLE_GUIDE_FATIGUE_COMPRESSION: envBool('ENABLE_GUIDE_FATIGUE_COMPRESSION', true),
  PERSONA_ADJUSTMENT_LEVEL: envEnum('PERSONA_ADJUSTMENT_LEVEL', ['low', 'medium', 'high'], 'medium'),
};
