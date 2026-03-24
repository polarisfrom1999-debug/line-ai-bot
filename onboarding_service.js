'use strict';

function safeText(value, fallback = '') {
  return String(value || fallback).trim();
}

function createMembershipAdminMemo(input = {}) {
  const userName = safeText(input.user_name || '利用者');
  const actionType = safeText(input.action_type || '');
  const currentPlan = safeText(input.current_plan || '');
  const targetPlan = safeText(input.target_plan || '');
  const membershipStatus = safeText(input.membership_status || '');
  const note = safeText(input.note || '');
  const createdAt = safeText(input.created_at || new Date().toISOString());

  const lines = [
    '[会員導線メモ]',
    `作成日時: ${createdAt}`,
    `利用者: ${userName}`,
    membershipStatus ? `現在状態: ${membershipStatus}` : null,
    currentPlan ? `現在プラン: ${currentPlan}` : null,
    targetPlan ? `変更先プラン: ${targetPlan}` : null,
    actionType ? `希望アクション: ${actionType}` : null,
    note ? `補足: ${note}` : null,
  ].filter(Boolean);

  return {
    memo_text: lines.join('\n'),
    summary: {
      user_name: userName,
      action_type: actionType,
      membership_status: membershipStatus,
      current_plan: currentPlan,
      target_plan: targetPlan,
      note,
      created_at: createdAt,
    },
  };
}

module.exports = {
  createMembershipAdminMemo,
};
