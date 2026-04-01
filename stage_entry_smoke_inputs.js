'use strict';

function envBool(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

const flags = {
  USE_NEW_ORCHESTRATOR: envBool('USE_NEW_ORCHESTRATOR', false),
  ENABLE_STAGE_ENTRY_GUIDANCE: envBool('ENABLE_STAGE_ENTRY_GUIDANCE', false),
  ENABLE_GUIDANCE_GENERAL: envBool('ENABLE_GUIDANCE_GENERAL', false),
  ENABLE_GUIDANCE_SUMMARY_VIEW: envBool('ENABLE_GUIDANCE_SUMMARY_VIEW', false),
  ENABLE_GUIDANCE_PERSONA: envBool('ENABLE_GUIDANCE_PERSONA', false),
  ENABLE_GUIDANCE_SYMPTOM_ENTRY: envBool('ENABLE_GUIDANCE_SYMPTOM_ENTRY', false),
  ENABLE_GUIDANCE_HOMECARE_ENTRY: envBool('ENABLE_GUIDANCE_HOMECARE_ENTRY', false),
  ENABLE_GUIDANCE_SPORTS_ENTRY: envBool('ENABLE_GUIDANCE_SPORTS_ENTRY', false),
  ENABLE_GUIDANCE_COMPETITION_ENTRY: envBool('ENABLE_GUIDANCE_COMPETITION_ENTRY', false),
};

console.log('Stage Entry flag report');
console.log('------------------------');
for (const [key, value] of Object.entries(flags)) {
  console.log(`${key}=${value ? 'ON' : 'OFF'}`);
}

console.log('
Recommended deploy order:');
console.log('1. USE_NEW_ORCHESTRATOR=1');
console.log('2. ENABLE_STAGE_ENTRY_GUIDANCE=1');
console.log('3. ENABLE_GUIDANCE_GENERAL=1 ENABLE_GUIDANCE_SUMMARY_VIEW=1 ENABLE_GUIDANCE_PERSONA=1');
console.log('4. ENABLE_GUIDANCE_SYMPTOM_ENTRY=1');
console.log('5. ENABLE_GUIDANCE_HOMECARE_ENTRY=1 ENABLE_GUIDANCE_SPORTS_ENTRY=1 ENABLE_GUIDANCE_COMPETITION_ENTRY=1');
