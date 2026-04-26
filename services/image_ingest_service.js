'use strict';

const lineMediaService = require('./line_media_service');

async function ingestLineImage(input) {
  const payload = await lineMediaService.getImagePayload(input);
  if (!payload) {
    return {
      ok: false,
      error: 'image_payload_unavailable'
    };
  }

  return {
    ok: true,
    payload
  };
}

module.exports = {
  ingestLineImage
};
