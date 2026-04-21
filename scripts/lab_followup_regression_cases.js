'use strict';

const assert = require('assert');
const labFollowupService = require('../services/lab_followup_service');

const panel = {
  patientName: '山田 太郎',
  facilityName: 'ここから内科クリニック',
  printDate: '2025-03-25',
  latestExamDate: '2025-03-22',
  examDates: ['2017-04-11', '2025-03-22'],
  items: [
    {
      itemName: '中性脂肪',
      value: '61',
      unit: 'mg/dL',
      history: [
        { date: '2017-04-11', value: '188', unit: 'mg/dL', flag: 'H' },
        { date: '2025-03-22', value: '61', unit: 'mg/dL', flag: '' },
      ]
    },
    {
      itemName: 'LDL',
      value: '125',
      unit: 'mg/dL',
      history: [
        { date: '2025-03-22', value: '125', unit: 'mg/dL', flag: 'H' }
      ]
    }
  ]
};

function run() {
  assert(labFollowupService.buildPatientNameReply(panel).includes('山田'));
  assert(labFollowupService.buildFacilityNameReply(panel).includes('クリニック'));
  assert(labFollowupService.buildPrintDateReply(panel).includes('2025-03-25'));
  assert(labFollowupService.buildLatestDateReply(panel).includes('2025-03-22'));
  assert(labFollowupService.buildItemReply(panel, 'TG', '2025-03-22').includes('61'));
  assert(labFollowupService.buildItemReply(panel, 'LDL', '2025-03-22').includes('125'));
  assert(labFollowupService.buildAbnormalItemsReply(panel).includes('H'));
  console.log('lab follow-up regression cases: ok');
}

run();
