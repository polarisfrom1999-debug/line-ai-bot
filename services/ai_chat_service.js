'use strict';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function normalizeText(value) {
  return String(value || '').trim();
}

function countNonEmptyLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function clampReplyLines(text, maxLines) {
  const safeLines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!safeLines.length) return '';
  if (!Number.isFinite(maxLines) || maxLines <= 0) return safeLines.join('\n');
  if (safeLines.length <= maxLines) return safeLines.join('\n');
  return safeLines.slice(0, maxLines).join('\n');
}

function softenAnxietyWording(text) {
  return normalizeText(text)
    .replace(/危険です。?/g, '負担が大きい可能性があります。')
    .replace(/今すぐやめてください。?/g, 'いったん止めて様子を見ましょう。')
    .replace(/絶対に/g, 'できるだけ')
    .replace(/必ずしも/g, '無理に');
}

function resolveReplyBudget(params = {}) {
  const energyLevel = normalizeText(params?.energyLevel || 'middle');
  const responseMode = normalizeText(params?.responseMode || 'empathy_plus_one_hint');
  const supportPreference = Array.isArray(params?.longMemory?.supportPreference)
    ? params.longMemory.supportPreference
    : [];

  if (energyLevel === 'low') return 3;
  if (supportPreference.includes('短く返す')) return 3;
  if (/guided/.test(responseMode)) return 6;
  if (/empathy_only/.test(responseMode)) return 3;
  return 5;
}

function postProcessReply(text) {
  const safe = normalizeText(text);
  if (!safe) {
    return 'うん、ちゃんと受け取りました。今の流れに合わせて、一緒に整えていきましょう。';
  }

  return softenAnxietyWording(
    safe
    .replace(/報告ありがとうございます。?/g, '')
    .replace(/引き続き頑張りましょう。?/g, 'また一緒に整えていきましょう。')
    .replace(/素晴らしいです。?/g, 'いい流れですね。')
      .trim()
  );
}

function inferAiStyle(aiType) {
  const safe = normalizeText(aiType);
  if (/頼もしく導く|理屈|整理/.test(safe)) return 'logic_first';
  if (/そっと寄り添う|やさしく|伴走/.test(safe)) return 'gentle_first';
  if (/明るく後押し|背中を押す/.test(safe)) return 'push_lightly';
  if (/力強く支える/.test(safe)) return 'strong_support';
  return 'balanced';
}

function inferVoiceStyleHint(voiceStyle) {
  const safe = normalizeText(voiceStyle);
  if (/いつも明るく/.test(safe)) {
    return '軽さを少し出して前向きに。テンションは上げすぎない。';
  }
  if (/普段優しく、ときどき厳しく/.test(safe)) {
    return '通常はやさしく、頑張りすぎ時のみ短く芯のある言葉を使う。';
  }
  if (/いつも優しく/.test(safe)) {
    return 'やわらかい語尾を優先し、圧の強い言い回しを避ける。';
  }
  return '自然な話し言葉で温度を合わせる。';
}

function buildSystemPrompt(hiddenContext, responseMode, longMemory) {
  const aiStyle = inferAiStyle(longMemory?.aiType);
  const voiceStyle = normalizeText(longMemory?.voiceStyle || '');
  const voiceStyleHint = inferVoiceStyleHint(voiceStyle);
  const preferredName = normalizeText(longMemory?.preferredName || '');
  const supportPreference = Array.isArray(longMemory?.supportPreference) ? longMemory.supportPreference.slice(0, 4) : [];
  const supportPreferenceText = supportPreference.length ? supportPreference.join(' / ') : '';
  const energyLevel = normalizeText(longMemory?.currentEnergyLevel || 'middle');

  return [
    'あなたは「ここから。」の AI牛込 です。',
    '単なる記録AIではなく、人生の伴走OSとして振る舞ってください。',
    '最優先は「正しさの押し付け」ではなく「可能性の発見」です。',
    'まず人を見てください。記録や分析はそのあとです。',
    '口調はやや柔らかく、説教しません。丁寧すぎず、少し大人の余裕があります。',
    '会話はLINE向けで、1〜5文程度を基本にします。',
    '同じ冒頭や同じ締めを続けて使わず、少し揺らぎのある人間らしい言い回しにしてください。',
    '会話の順番は「受け止める→必要なら整理→提案は1つまで」です。',
    '強みを先に返し、課題は短く1つまで。できる最小の一歩へ落としてください。',
    '返答順は原則として「事実→強み→気になる点→小さな提案→安心の一言」を守ってください。',
    '不安を煽る表現、断定的な診断、人格否定は絶対にしないでください。',
    '改善提案は1〜2個まで。低エネルギー時は提案を1個以下にしてください。',
    '質問攻めにしないでください。質問は本当に必要な時だけ1つまでです。',
    '雑談や相談はすぐ記録モードに戻しすぎないでください。',
    'しんどさ・痛み・不安がある時は、改善提案より先に負担を増やさない方向を優先してください。',
    '「報告ありがとうございます」「素晴らしいです」「引き続き頑張りましょう」は使わないでください。',
    preferredName ? `ユーザーの呼び方の候補: ${preferredName}` : null,
    `AIスタイル: ${aiStyle}`,
    voiceStyle ? `雰囲気: ${voiceStyle}` : null,
    `雰囲気ヒント: ${voiceStyleHint}`,
    supportPreferenceText ? `支え方の好み: ${supportPreferenceText}` : null,
    `energy_level: ${energyLevel}`,
    `responseMode: ${responseMode || 'empathy_plus_one_hint'}`,
    '返答は長くしすぎず、要点を先に書いてください。',
    hiddenContext ? hiddenContext : '',
    '直近の会話の言い回しをなぞりすぎないでください。'
  ].filter(Boolean).join('\n');
}

function convertRecentMessages(recentMessages) {
  const messages = Array.isArray(recentMessages) ? recentMessages : [];
  return messages
    .slice(-12)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: normalizeText(m.content)
    }))
    .filter((m) => m.content);
}

function fallbackGenerate(params) {
  const text = normalizeText(params?.userMessage || '');
  const stateFlags = Array.isArray(params?.stateFlags) ? params.stateFlags : [];

  if (stateFlags.includes('safety_attention') || /心が苦しい|消えたい|激痛|骨折/.test(text)) {
    return 'それはかなり優先度の高いしんどさですね。今は整えることより安全を先にして、無理を増やさない動きで考えましょう。';
  }

  if (stateFlags.includes('pain') || /痛い|つらい|しんどい|苦しい/.test(text)) {
    return 'うーん、それはしんどかったですね。今は無理に整えようとしすぎず、まず負担を増やさない方向で見ていきましょう。';
  }

  if (stateFlags.includes('fatigue') || /疲れ|眠い|寝不足|だるい/.test(text)) {
    return 'なるほど。今日は頑張って整えるというより、消耗を増やしすぎない方が大事そうですね。';
  }

  if (/走った|ジョギング|スクワット|運動/.test(text)) {
    return 'ちゃんと動けていますね。量の大小より、続けて体を動かせている流れに意味があります。';
  }

  if (/食べた|朝ごはん|昼ごはん|夜ごはん|ラーメン|寿司|カレー/.test(text)) {
    return 'うん、食事の流れはちゃんと受け取れています。責めるより、次にどう整えやすいかを一緒に見ていきましょう。';
  }

  if (/ありがとう|助かった/.test(text)) {
    return 'そう言ってもらえてよかったです。またその時々で一緒に見ていきましょう。';
  }

  if (!text) {
    return 'うん、ちゃんと受け取れています。今の流れに合わせて、一緒に整えていきましょう。';
  }

  return 'なるほど。今の感じはちゃんと受け取れています。無理に急がず、今のあなたに合う形で一緒に見ていきましょう。';
}

async function callOpenAI(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') {
    return '';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(OPENAI_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        messages
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[ai_chat_service] openai error:', text || response.status);
      return '';
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('[ai_chat_service] callOpenAI error:', error?.message || error);
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function generateReply(params) {
  const longMemory = {
    ...(params?.longMemory || {}),
    currentEnergyLevel: normalizeText(params?.energyLevel || 'middle')
  };
  const systemPrompt = buildSystemPrompt(params?.hiddenContext, params?.responseMode, longMemory);
  const recent = convertRecentMessages(params?.recentMessages);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent,
    { role: 'user', content: normalizeText(params?.userMessage || '') }
  ];

  const raw = await callOpenAI(messages);
  const budget = resolveReplyBudget(params);
  if (!normalizeText(raw)) {
    return clampReplyLines(fallbackGenerate(params), budget);
  }

  const post = postProcessReply(raw);
  const trimmed = clampReplyLines(post, budget);
  if (!trimmed) return clampReplyLines(fallbackGenerate(params), budget);
  if (countNonEmptyLines(trimmed) < 2 && normalizeText(params?.energyLevel || '') !== 'low' && /empathy_plus_one_hint/.test(normalizeText(params?.responseMode || ''))) {
    return `${trimmed}\n必要なら次の一手を一緒に1つだけ決めましょう。`;
  }
  return trimmed;
}

module.exports = {
  generateReply,
  inferAiStyle
};
