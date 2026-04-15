"use strict";

function run() {
  try {
    const imageProcessor = require("../services/image_processor");
    const requiredExports = [
      "extractKeyframesFromVideo",
      "normalizeImageBuffer",
      "normalizeImageFile",
      "prepareInlineImages",
      "compactInlineFrames",
      "normalizeEnergyLevel",
    ];

    const missing = requiredExports.filter((key) => typeof imageProcessor?.[key] !== "function");
    if (missing.length) {
      console.error("[smoke:image-processor-load] missing exports:", missing.join(", "));
      process.exitCode = 1;
      return;
    }

    console.log("[smoke:image-processor-load] ok: image_processor loaded successfully");
  } catch (error) {
    console.error("[smoke:image-processor-load] failed:", error?.message || error);
    process.exitCode = 1;
  }
}

run();
