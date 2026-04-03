'use strict';

function buildSupportMode({ profile = {}, memory = {}, latestInput = '' } = {}) {
  const text = String(latestInput || '');
  const lowEnergy = /疲れ|しんどい|つらい|無理|眠い|だるい/.test(text);
  const pain = /痛い|しびれ|違和感|張る|腰|膝|股関節/.test(text);

  let mode = 'steady';
  if (pain || lowEnergy) mode = 'protect';
  else if (/頑張る|やる|進めたい|整えたい/.test(text)) mode = 'organize';

  const map = {
    protect: {
      label: '守りながら進める',
      hint: '無理を増やさず、安全寄りの伴走にします。',
    },
    organize: {
      label: '整える寄り',
      hint: '少し整理して次の一歩を見つける返しにします。',
    },
    steady: {
      label: '休む寄りでも進む寄りでもない自然運転',
      hint: '構えすぎず自然な会話で支えます。',
    },
  };

  return {
    mode,
    title: '今日の向き合い方',
    shortText: map[mode].label,
    guidanceHint: map[mode].hint,
  };
}

module.exports = { buildSupportMode };
