'use strict';

function getPointsForRecord(recordType) {
  switch (recordType) {
    case 'meal': return 5;
    case 'weight': return 5;
    case 'exercise': return 5;
    case 'lab': return 10;
    case 'weekly': return 8;
    case 'monthly': return 12;
    default: return 3;
  }
}

module.exports = { getPointsForRecord };
