'use strict';

const assert = require('assert');
const ingress = require('../services/v2/image_ingress_v2_service');
const dispatch = require('../services/gemini_dispatch_service');

async function run() {
  assert.strictEqual(typeof ingress.handleImageIngressV2, 'function');
  assert.strictEqual(typeof dispatch.generateStructuredImageJson, 'function');

  const nonImage = await ingress.handleImageIngressV2({
    input: { userId: 'smoke-user', messageType: 'text', rawText: 'hello' },
    textHint: 'hello'
  });
  assert.strictEqual(nonImage.handled, false);
  console.log('smoke_v2_image_ingress: ok');
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
