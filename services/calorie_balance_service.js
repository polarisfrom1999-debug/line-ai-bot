'use strict';

function sumKcal(records) {
  return (Array.isArray(records) ? records : []).reduce((total, row) => total + Number(row && row.kcal || 0), 0);
}

function buildDailyBalanceSummary({ intakeRecords, activityRecords, basalMetabolism }) {
  const intakeKcal = sumKcal(intakeRecords);
  const activityKcal = sumKcal(activityRecords);
  const bmr = Number(basalMetabolism || 0);
  const net = intakeKcal - activityKcal - bmr;

  return {
    intakeKcal,
    activityKcal,
    basalMetabolism: bmr,
    netKcal: net,
  };
}

module.exports = {
  sumKcal,
  buildDailyBalanceSummary,
};
