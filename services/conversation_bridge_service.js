'use strict';

function pickLastMeaningfulTopic(memory = {}) {
  const topics = [];
  const pushIf = (label, value) => {
    if (value && String(value).trim()) topics.push({ label, value: String(value).trim() });
  };

  pushIf('pain', memory.lastPainTopic || memory.painSummary);
  pushIf('diet', memory.lastDietTopic || memory.lastMealPattern);
  pushIf('lab', memory.lastLabConcern || memory.lastLabTopic);
  pushIf('goal', memory.goal);
  pushIf('mood', memory.lastMoodTopic);

  return topics[0] || null;
}

function buildConversationBridge({ profile = {}, memory = {}, now = new Date() } = {}) {
  const topic = pickLastMeaningfulTopic(memory);
  const preferredName = profile.preferredName || null;

  if (!topic) return null;

  const hint = topic.label === 'pain'
    ? '前回の体の話の続きから入りやすいです。'
    : topic.label === 'lab'
      ? '前回の検査の不安や気になる数値から再開しやすいです。'
      : '前回から続く流れで入りやすいです。';

  return {
    title: '前回から続けやすい話題',
    shortText: preferredName
      ? `${preferredName}さんは、前回の「${topic.value}」の続きから入りやすそうです。`
      : `前回の「${topic.value}」の続きから入りやすそうです。`,
    guidanceHint: `${hint} 焦って全部説明し直さなくても大丈夫です。`,
  };
}

module.exports = { buildConversationBridge };
