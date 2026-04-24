'use strict';

/**
 * 日次収支 query + 返信ビルダのスモーク（DB 接続があれば該当 user の集計を表示）
 */
const dailyBalanceQuery = require('../services/daily_balance_query_service');
const responseBuilder = require('../services/newflow/response_builder_service');

async function main() {
  const userId = process.env.SMOKE_DAILY_BALANCE_USER_ID || 'smoke-daily-balance';
  const b = await dailyBalanceQuery.getTokyoDayEnergyBalance(userId, null);
  console.log('getTokyoDayEnergyBalance:', JSON.stringify(b, null, 2));
  if (b) {
    console.log('--- replies ---');
    console.log('[今日の合計]', responseBuilder.buildTodayMealTotalReply(b));
    console.log('[今日の収支]', responseBuilder.buildTodayBalanceReply(b));
    console.log('[摂取どのくらい]', responseBuilder.buildTodayIntakeAskReply(b));
    console.log('[活動どのくらい]', responseBuilder.buildTodayActivityAskReply(b));
  }
  console.log('smoke_daily_balance: ok');
}

main().catch((e) => {
  console.error(e?.stack || e);
  process.exit(1);
});
