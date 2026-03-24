'use strict';

function buildSoftFollowup({ route = '', userText = '', topicHints = {} } = {}) {
  const text = String(userText || '').trim();

  if (route === 'record_candidate' && topicHints?.meal) {
    return 'ありがとうございます。食事の内容は受け取れています。違うところだけ、そのまま教えてくださいね。';
  }

  if (route === 'record_candidate' && topicHints?.exercise) {
    return 'ありがとうございます。内容は受け取れています。時間や回数があれば、そのまま続けて送ってくださいね。';
  }

  if (route === 'consultation') {
    return '大丈夫です。このまま話していただいて大丈夫です。まとまっていなくても、そのままで大丈夫ですよ。';
  }

  if (text) {
    return 'ありがとうございます。続けてそのまま教えてくださいね。必要な形はこちらで整えます。';
  }

  return 'ありがとうございます。続けて教えてくださいね。';
}

module.exports = {
  buildSoftFollowup,
};
