'use strict';

const weeklyBalanceQuery = require('../services/weekly_balance_query_service');
const responseBuilder = require('../services/newflow/response_builder_service');

async function main() {
  const userId = process.env.SMOKE_WEEKLY_BALANCE_USER_ID || 'smoke-weekly-balance';
  const w = await weeklyBalanceQuery.getTokyoWeekEnergyBalance(userId, null);
  console.log('getTokyoWeekEnergyBalance:', JSON.stringify(w, null, 2));
  if (w) {
    console.log('--- replies ---');
    console.log('[今週のまとめ]', responseBuilder.buildWeekSummaryReply(w));
    console.log('[今週の収支]', responseBuilder.buildWeekBalanceReply(w));
    console.log('[今週 食事]', responseBuilder.buildWeekIntakeAskReply(w));
  }
  console.log('smoke_weekly_balance: ok');
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
