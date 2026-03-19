'use strict';

/**
 * config/plan_links.js
 *
 * Stripeの決済リンクをここにまとめます。
 * まだ未発行なら空文字のままで大丈夫です。
 */

module.exports = {
  light: process.env.STRIPE_LINK_LIGHT || '',
  basic: process.env.STRIPE_LINK_BASIC || '',
  premium: process.env.STRIPE_LINK_PREMIUM || '',
};
