'use strict';

function normalizeText(v) {
  return String(v || '').trim();
}

const GROUPS = {
  affirmation: [
    '良いです',
    'かなり良いです',
    'これは大きいです',
    'ちゃんと形になっています',
    'いい選択です',
    '続けやすい形です',
    '今日の状況なら十分です',
    'このペースで十分です'
  ],
  closing_soft: [
    '今日はこの形で十分です。',
    'この調子で、焦らずいきましょう。',
    'ここまでできていれば大丈夫です。',
    '午後は水分だけ忘れずにいきましょう。',
    '無理に整えなくて大丈夫そうです。'
  ]
};

function pickAvoidingRecent(candidates, recentAssistantBodies = []) {
  const rows = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!rows.length) return { phrase: '', avoided_recent_phrase: '', phrase_group: '' };
  const recent = Array.isArray(recentAssistantBodies) ? recentAssistantBodies : [];
  let avoided = '';
  for (const c of rows) {
    const used = recent.some((r) => r.includes(c));
    if (!used) return { phrase: c, avoided_recent_phrase: avoided, phrase_group: '' };
    avoided = c;
  }
  return { phrase: rows[0], avoided_recent_phrase: avoided, phrase_group: '' };
}

/**
 * @param {{ phrase_group: string, recent_assistant_texts?: string[], silent?: boolean }} params
 */
function selectHumanPhraseVariation(params = {}) {
  const group = normalizeText(params.phrase_group || 'affirmation');
  const bank = GROUPS[group] || GROUPS.affirmation;
  const recent = params.recent_assistant_texts || [];
  const pick = pickAvoidingRecent(bank, recent);
  const selected = pick.phrase;
  if (!params.silent) {
    console.info('[human_phrase_variation_selected]', {
      phrase_group: group,
      selected_phrase: selected,
      avoided_recent_phrase: pick.avoided_recent_phrase || '(none)'
    });
  }
  return { phrase: selected, phrase_group: group, avoided_recent_phrase: pick.avoided_recent_phrase };
}

module.exports = {
  GROUPS,
  selectHumanPhraseVariation
};
