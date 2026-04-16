'use strict';

const assistantRepeatGuard = require('./assistant_repeat_guard');

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
    return 'うん、受け取れてるよ。何かあればまた一文で送って。';
  }

  return softenAnxietyWording(
    safe
    .replace(/報告ありがとうございます。?/g, '')
    .replace(/引き続き頑張りましょう。?/g, 'また続きを聞かせて。')
    .replace(/素晴らしいです。?/g, 'いい流れですね。')
    .replace(/一緒に整えていきましょう。?/g, 'また必要なところだけ詰めよう。')
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
    'あなたは「ここから。」の牛込先生のAIとして、ChatGPTで自然に雑談・相談しているような流れを基本にしてください。',
    '医療判断や診断はしません。安全が気になるときは受診・専門家への相談を促します。',
    '「伴走」「安心」「一緒に」など、励ましの定型語を毎回・複数は使わないでください（1通に多くて1つまで）。',
    '同じ前置き・同じ締め・同じ型の段落を続けないでください。毎回、冒頭の言い出しを変えてください。',
    'ユーザーの短い質問や一言には、まずその問いに直接答えてください。前置きや説明は足さないでください。',
    '深い相談や複数の悩みが並ぶときだけ、短く整理してから一歩だけ提案してください。',
    '口調はやわらかく、説教や上から目線は避けます。丁寧すぎない、少し余裕のある大人の話し言葉です。',
    '会話は1〜5文が目安ですが、短い相手には1〜2文で十分です。',
    '強みや良い点があれば先に短く触れてもよいですが、テンプレの「事実→強み→…」を毎回なぞらないでください。',
    '不安を煽る表現、断定的な診断、人格否定は絶対にしないでください。',
    '改善提案は多くて2つまで。低エネルギー時は1つ以下にしてください。',
    '質問は本当に必要なときだけ1つまでにしてください。',
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
    return '食事の流れは受け取れています。責めずに、次に崩れにくい形を一つだけ決めましょう。';
  }

  if (/ありがとう|助かった/.test(text)) {
    return 'そう言ってもらえてよかったです。また必要な時に続けましょう。';
  }

  if (!text) {
    return 'うん、届いてるよ。また送って。';
  }

  return 'なるほど。今の感じは受け取れた。急がず、必要なところからでいいよ。';
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
  const recentBodies = assistantRepeatGuard.recentAssistantBodies(params?.recentMessages || [], 5);
  return assistantRepeatGuard.stripBannedLines(assistantRepeatGuard.scrubReplyAgainstRecent(trimmed, recentBodies));
}

module.exports = {
  generateReply,
  inferAiStyle
};
