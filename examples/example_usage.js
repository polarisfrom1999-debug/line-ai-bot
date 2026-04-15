const corePersonality = require('../prompts/kokokara_core_personality_prompt');
const motionPrompt = require('../prompts/kokokara_motion_analysis_prompt');
const responseRules = require('../prompts/kokokara_response_style_rules');
const menuRehabRules = require('../prompts/kokokara_menu_rehab_rules');

function buildMotionSystemPrompt({ timeOfDay, energyLevel }) {
  const timeHint =
    timeOfDay === 'morning' ? responseRules.timeModifiers.morning :
    timeOfDay === 'night' ? responseRules.timeModifiers.night :
    responseRules.timeModifiers.daytime;

  const energyHint =
    energyLevel === 'low'
      ? responseRules.energyLevelRule
      : '必要十分な情報量で返す';

  return [
    corePersonality,
    motionPrompt,
    menuRehabRules,
    `【時間補正】${timeHint}`,
    `【energy_level補正】${energyHint}`
  ].join('\n\n');
}

module.exports = { buildMotionSystemPrompt };
