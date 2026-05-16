'use strict';

/**
 * Phase G-4: セルフケア後の反応フォロー（短文の分類と返答方針）
 */

const REACTION_KIND = {
  BETTER: 'better',
  SAME: 'same',
  WORSE: 'worse',
  NUMB: 'numb',
  SCARED: 'scared',
  MORE: 'more',
  DONE_ACK: 'done_ack',
  UNKNOWN: 'unknown',
};

function normalizeText(v) {
  return String(v || '').trim();
}

function isReactionFollowUpText(text = '') {
  const t = normalizeText(text);
  if (!t || t.length > 56) return false;
  if (
    /^(できた|できました|楽|軽くなった|少し良い|変わらない|痛い|悪化|しびれ|怖い|もう少しできそう)[\s、。!！]?$/u.test(t)
  ) {
    return true;
  }
  if (
    /^(楽になり|楽になっ|軽くなっ|少し良くなっ|変わらなかっ|痛くなっ|痛くなり|悪化し|しびれま|しびれた|怖くなっ)/.test(t)
  ) {
    return true;
  }
  if (/^(楽|軽い|痛い|しびれ|怖い)(です|でした|ました)/.test(t)) return true;
  if (/もう少しできそう/.test(t)) return true;
  return false;
}

function classifyMovementReaction(text = '') {
  const t = normalizeText(text);
  if (/しびれ|しびれた/.test(t)) return { kind: REACTION_KIND.NUMB, policy: 'stop_self_care_medical_first' };
  if (/痛くなっ|痛くなり|悪化/.test(t)) return { kind: REACTION_KIND.WORSE, policy: 'stop_adjust_or_medical' };
  if (/^痛い$|痛いです|痛いでした/.test(t)) return { kind: REACTION_KIND.WORSE, policy: 'stop_adjust_or_medical' };
  if (/怖い|怖く/.test(t)) return { kind: REACTION_KIND.SCARED, policy: 'reassure_stop_no_push' };
  if (/変わらない|変わらなかっ/.test(t)) return { kind: REACTION_KIND.SAME, policy: 'try_different_light_move' };
  if (/もう少しできそう/.test(t)) return { kind: REACTION_KIND.MORE, policy: 'do_not_increase_hold_same' };
  if (/^できた|できました/.test(t)) return { kind: REACTION_KIND.DONE_ACK, policy: 'same_volume_next_time' };
  if (/楽になり|楽になっ|軽くなっ|少し良くなっ|少し良い/.test(t) && !/痛|悪化|しびれ/.test(t)) {
    return { kind: REACTION_KIND.BETTER, policy: 'praise_no_intensity_up_same_feel' };
  }
  if (/^楽[。!！\s]*$/.test(t)) return { kind: REACTION_KIND.BETTER, policy: 'praise_no_intensity_up_same_feel' };
  return { kind: REACTION_KIND.UNKNOWN, policy: 'ask_which_closest' };
}

function formatReactionHintsForPrompt(reaction) {
  if (!reaction || reaction.kind === REACTION_KIND.UNKNOWN) return '';
  const map = {
    [REACTION_KIND.BETTER]: '良い反応。すぐ回数を増やさない。同じ強さで「再現できるか」を次も見る。',
    [REACTION_KIND.SAME]: '無理に増やさない。次は別方向のやさしい動きへ切り替え候補。',
    [REACTION_KIND.WORSE]: '中止。強さか方向が合っていなかった可能性。必要なら医療・専門の確認を優先。',
    [REACTION_KIND.NUMB]: 'セルフケアは止める。神経に響いている可能性があるため確認優先。続けさせない。',
    [REACTION_KIND.SCARED]: '不安を受け止め、無理に続けない。今日は休む選択でよい。',
    [REACTION_KIND.MORE]: '増やさない。同じ強さで十分と伝える。',
    [REACTION_KIND.DONE_ACK]: '今日はそれで十分。次回も同じ量からでよい。',
  };
  return `[反応フォロー: ${reaction.kind}] ${map[reaction.kind] || ''}`;
}

module.exports = {
  REACTION_KIND,
  isReactionFollowUpText,
  classifyMovementReaction,
  formatReactionHintsForPrompt,
};
