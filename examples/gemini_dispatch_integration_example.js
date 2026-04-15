"use strict";

/**
 * examples/gemini_dispatch_integration_example.js
 *
 * 既存の gemini_dispatch_service.js へ動作解析を疎結合で追加する例。
 */

const { extractKeyframesFromVideo, prepareInlineImages } = require("../services/image_processor");
const { analyzeMotionFrames } = require("../services/motion_analysis_service");

async function dispatchMotionAnalysis({
  videoPath,
  imagePaths,
  context,
}) {
  let frames = [];

  if (videoPath) {
    frames = await extractKeyframesFromVideo({
      videoPath,
      frameCount: 5,
    });
  } else if (Array.isArray(imagePaths) && imagePaths.length > 0) {
    frames = await prepareInlineImages(imagePaths.map((filePath) => ({ path: filePath })));
  } else {
    throw new Error("videoPath or imagePaths is required.");
  }

  const result = await analyzeMotionFrames({
    frames,
    context: {
      sport: context?.sport || "",
      motionType: context?.motionType || "",
      symptoms: context?.symptoms || "",
      goal: context?.goal || "",
      note: context?.note || "",
      timeOfDay: context?.timeOfDay || "",
      energyLevel: context?.energyLevel || "unknown",
      userProfile: context?.userProfile || "",
    },
  });

  return {
    ok: true,
    analysisType: "motion",
    result,
  };
}

module.exports = {
  dispatchMotionAnalysis,
};
