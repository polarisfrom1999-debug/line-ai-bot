'use strict';

const mealReplyFormatterService = require('./meal_reply_formatter_service');

function formatMealLineReply(parsedMeal, options = {}) {
  return mealReplyFormatterService.formatMealReplyText(parsedMeal, options);
}

module.exports = {
  formatMealLineReply,
  pickMotivationComment: mealReplyFormatterService.pickMotivationComment,
};
