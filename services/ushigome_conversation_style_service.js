'use strict';

/**
 * AI牛込 — 返信文は作らず、自然生成用の判断ヒント（style / thinking）を組み立てる。
 * 3名分の実会話から抽象化した原則のみ。個人名・具体エピソードは使わない。
 */

const ARCHETYPE = {
  STRONG_WEIGHT_LOSS: 'strong_weight_loss_with_health_risk',
  LIFE_EVENT: 'life_event_balancer',
  HIGH_COMPLIANCE: 'high_compliance_micro_adjuster',
};

const CORE_STYLE_PRINCIPLES = [
  'まず相手の今の言葉に直接反応する（感情が乗っている部分を最初に）',
  '数字より先に、その人がどう感じているかを見る',
  '褒めるときは具体的に（何が良いのかを言う）',
  '失敗・食べすぎ・忘れは叱らず、戻し方を学ぶ材料として扱う',
  '次の一手は必ず小さく（今日はこれだけ、5回だけ、水分だけ等）',
  '生活背景（仕事・育児・外食・睡眠・家事・移動）を拾う',
  '安定した習慣は本人を支える型として尊重し、根拠なく「安定」と言い切らない',
  '楽しみ（外食・お菓子・お茶会）は敵にせず、翌日・次の食事で整える',
  '痛み・不調は成果より安全（休息・水分・軽いストレッチ・無理しない）',
  '行動を学びとして言語化する（調整力・気付き・半分が身につく等）',
  '必要な時だけ先生として軽く一言（主役は利用者）',
  '最後は会話が続く余白を残す（質問攻めにしない）',
];

const RESPONSE_PRIORITY_ORDER = [
  '赤旗・危険兆候',
  '痛み・体調不良・睡眠不足・頭痛',
  'ユーザーの感情',
  '今日できた具体行動',
  '食事・運動・体重などの数値',
  '次の小さな一手',
  '必要なら質問',
];

const THINKING_FLOW = ['受ける', '見る', '整える', '次へ', '余白'];

const AVOID_PATTERNS = [
  '大丈夫です、無理なく、一緒に頑張りましょう だけで終わる',
  'すごいですね だけで具体がない',
  '食べすぎ・体重増・運動できなかったことを失敗扱いする',
  '痛み・頭痛があるのに運動量を増やす提案',
  '食欲がない・頭痛を減量成功として褒めすぎる',
  '生活背景を無視した理想論',
  '毎回同じ締め・定型の安心文',
  '数値だけで終わる',
  '医療診断・治療断定',
];

function normalizeText(v) {
  return String(v || '').trim();
}

function inferThemes(text = '') {
  const t = normalizeText(text);
  const themes = {
    emotionalWeight: /心が重|つら|しんど|寂|不安|悔/.test(t),
    rewardFood: /食べちゃ|食べすぎ|おはぎ|お菓子|ケーキ|ご褒美/.test(t),
    weightLoss: /体重.*減|痩せ|落ちた/.test(t),
    weightGain: /体重.*増|太っ|重くな/.test(t),
    lowAppetite: /食欲がない|食べられない|あまり食べ/.test(t),
    portionControl: /半分|1\/4|少なめ|残した/.test(t),
    photoMissed: /写真.*忘れ|撮り忘れ/.test(t),
    painPresent: /痛い|痛み|痛く|腰痛|頭痛|肩|足|膝/.test(t),
    headache: /頭痛/.test(t),
    painImproved: /痛.*(楽|軽|よく)な|楽になり/.test(t),
    exerciseDone: /(スクワット|腕立て|縄跳び|ランニング|ウォーキング|走っ|歩い|草むしり).*(した|やった|回|分)/.test(t),
    exerciseSkipped: /運動できなかった|動けなかった|できませんでした/.test(t),
    lifeLoad: /抱っこ|子ども|劇団|お茶会|外食|草むしり|家事|仕事|忙し/.test(t),
    sleepIssue: /眠れ|寝不足|睡眠不足|遅くな/.test(t),
    constipation: /便|便秘|出ていない/.test(t),
    hydration: /水分|白湯|お茶/.test(t),
    routineStable: /毎朝|いつも同じ|ラジオ体操|同じヨーグルト|スムージー/.test(t),
  };
  return themes;
}

function inferArchetype(text = '', styleProfile = {}) {
  const t = normalizeText(text);
  let scoreA = 0;
  let scoreB = 0;
  let scoreC = 0;

  if (/頭痛|食欲がない|体重.*減|だる|腰痛|抱っこ|育児|糖質|食事量.*少/.test(t)) scoreA += 2;
  if (styleProfile.anxietyProne || styleProfile.weightSensitive) scoreA += 1;

  if (/外食|お茶会|劇団|ラジオ体操|歩数|予定|塩分|むくみ/.test(t)) scoreB += 2;
  if (styleProfile.happyFamilyShare) scoreB += 0.5;

  if (/半分|スクワット|草むしり|写真.*忘れ|細かく|コツコツ|調整/.test(t)) scoreC += 2;
  if (styleProfile.wantsDetailedNumbers) scoreC += 0.5;

  const max = Math.max(scoreA, scoreB, scoreC);
  if (max < 1) return null;
  if (scoreA === max) return ARCHETYPE.STRONG_WEIGHT_LOSS;
  if (scoreB === max) return ARCHETYPE.LIFE_EVENT;
  return ARCHETYPE.HIGH_COMPLIANCE;
}

function archetypeGuidance(archetype) {
  if (archetype === ARCHETYPE.STRONG_WEIGHT_LOSS) {
    return {
      label: '減量ペースと体調リスクの両立',
      priorities: [
        '体重の変化は認めるが、頭痛・だるさ・食事量不足を見逃さない',
        '育児・抱っこなど生活負荷を運動として拾う',
        '無理な運動追加より回復・糖質・休息を優先',
      ],
    };
  }
  if (archetype === ARCHETYPE.LIFE_EVENT) {
    return {
      label: '生活イベントとリズムの両立',
      priorities: [
        '外食・お茶会・劇団など楽しみを否定しない',
        '体重増は塩分・睡眠・むくみの候補として整理',
        '翌日いつものリズムに戻せば十分、と伝える',
      ],
    };
  }
  if (archetype === ARCHETYPE.HIGH_COMPLIANCE) {
    return {
      label: '細かい報告と調整力の育成',
      priorities: [
        '半分・小さな運動・家事・草むしりを具体的に拾う',
        '痛みがある時はフォーム・回数・中止条件',
        '我慢ではなく調整力がついている、と言語化',
      ],
    };
  }
  return null;
}

function buildUserStateInterpretation(text = '', themes = {}, conversationMode = '') {
  const t = normalizeText(text);
  let primaryEmotion = 'neutral';
  if (themes.emotionalWeight) primaryEmotion = 'distress';
  else if (themes.rewardFood) primaryEmotion = 'guilt_or_release';
  else if (themes.weightGain) primaryEmotion = 'worry';
  else if (themes.weightLoss && themes.lowAppetite) primaryEmotion = 'mixed_health_concern';
  else if (themes.exerciseDone) primaryEmotion = 'accomplishment';
  else if (themes.exerciseSkipped) primaryEmotion = 'disappointment_not_failure';
  else if (themes.painPresent) primaryEmotion = 'discomfort';
  else if (themes.painImproved) primaryEmotion = 'relief';

  let safetyLevel = 'normal';
  if (/消えたい|もう無理|意識が|激しい痛|吐き気が止まら|高熱/.test(t)) safetyLevel = 'red_flag';
  else if (themes.painPresent || themes.headache || themes.sleepIssue) safetyLevel = 'caution';

  const focusFirst = [];
  if (themes.painImproved) focusFirst.push('痛みが楽になった感覚');
  if (themes.painPresent && themes.exerciseDone) focusFirst.push('痛みの有無（運動より先）');
  if (themes.lowAppetite || themes.headache) focusFirst.push('体調・食欲（減量称賛より先）');
  if (themes.rewardFood) focusFirst.push('食べてしまった気持ち');
  if (themes.portionControl) focusFirst.push('半分にできた調整');
  if (themes.photoMissed) focusFirst.push('報告できたこと自体');
  if (themes.lifeLoad) focusFirst.push('生活の文脈');
  if (!focusFirst.length && t) focusFirst.push('発話の中心語');

  return {
    primaryEmotion,
    safetyLevel,
    focusFirst: focusFirst.slice(0, 2),
    conversationMode: normalizeText(conversationMode),
    themes,
  };
}

function buildSmallNextStepCandidates(text = '', themes = {}) {
  const candidates = [];
  if (themes.rewardFood) {
    candidates.push('次の食事で少し整える', '1個に戻せたら十分', '今日は責めずに記録だけ');
  }
  if (themes.weightGain) {
    candidates.push('明日の体重は一喜一憂しない', '水分を少し多めに', 'いつものリズムに戻す');
  }
  if (themes.lowAppetite || /頭痛/.test(text)) {
    candidates.push('少量の糖質・たんぱく質', '水分', '今夜は早めに休む');
  }
  if (themes.portionControl) {
    candidates.push('同じペースで半分を続ける', '夜はたんぱく質を軽めに');
  }
  if (themes.photoMissed) {
    candidates.push('文字で送ってもらえれば十分', '後からで大丈夫');
  }
  if (themes.painPresent && themes.exerciseDone) {
    candidates.push('痛みが増えたら中止', '回数よりフォーム', '今日は回数を増やさない');
  }
  if (themes.painImproved) {
    candidates.push('同じペースで続ける', '強度は上げない');
  }
  if (themes.exerciseDone && !themes.painPresent) {
    candidates.push('回数を増やすより続ける', '明日も同じくらいで十分');
  }
  if (themes.exerciseSkipped) {
    candidates.push('肩回しだけ', '明日はスクワットではなく軽いストレッチ', '休息も調整のうち');
  }
  if (themes.lifeLoad && /抱っこ|腰/.test(text)) {
    candidates.push('腰の負担を減らす姿勢', '無理な追加運動はしない');
  }
  if (themes.sleepIssue) {
    candidates.push('運動強度を下げる', '食事制限を強めない', '今夜は睡眠優先');
  }
  if (themes.constipation) {
    candidates.push('温かい汁物', '野菜・水分', '便の様子をまた教えてもらう');
  }
  if (themes.routineStable) {
    candidates.push('いつもの型を崩さない', '無理に変えない');
  }
  return [...new Set(candidates)].slice(0, 4);
}

function buildSafetyNotes(text = '', themes = {}, userState = {}) {
  const notes = [];
  if (userState.safetyLevel === 'red_flag') {
    notes.push('赤旗疑い: 医療機関への相談を優先。伴走で診断しない');
  }
  if (themes.painPresent) {
    notes.push('痛みがある日は成果より安全。運動量を増やさない');
  }
  if (/頭痛/.test(text) && themes.lowAppetite) {
    notes.push('頭痛+食欲低下は減量褒めより体調・糖質・休息');
  }
  if (themes.constipation && themes.weightGain) {
    notes.push('便通と体重の関係に触れて不安を軽くする。下剤や診断は急がない');
  }
  return notes;
}

function buildToneHints(styleProfile = {}, userState = {}) {
  const hints = {
    lineLength: 'short',
    warmth: 'calm_specific',
    praiseStyle: 'concrete_behavior',
    avoid: 'template_reassurance',
  };
  if (styleProfile.formalLover) hints.register = 'slightly_polite';
  if (styleProfile.casualLover || styleProfile.emojiLover) hints.register = 'friendly_plain';
  if (userState.safetyLevel === 'caution' || userState.safetyLevel === 'red_flag') {
    hints.lineLength = 'short_clear';
    hints.warmth = 'steady_safety';
  }
  if (styleProfile.mealMicroFeedbackSensitive) hints.detailLevel = 'minimal_numbers';
  return hints;
}

function mergeStyleProfile(longMemory = {}) {
  const p = longMemory?.conversationStyleProfile;
  return p && typeof p === 'object' ? p : {};
}

/**
 * @param {{ userText?: string, conversationMode?: string, intentType?: string, featureResults?: object, userContext?: object }} params
 */
function buildUshigomeStyleHints(params = {}) {
  const userText = normalizeText(params.userText || '');
  const conversationMode = normalizeText(params.conversationMode || params.intentType || '');
  const styleProfile = mergeStyleProfile(params.userContext?.longMemory || params.longMemory || {});
  const themes = inferThemes(userText);
  const archetype = inferArchetype(userText, styleProfile);
  const archetypeGuide = archetypeGuidance(archetype);
  const userStateInterpretation = buildUserStateInterpretation(userText, themes, conversationMode);
  const smallNextStepCandidates = buildSmallNextStepCandidates(userText, themes);
  const safetyNotes = buildSafetyNotes(userText, themes, userStateInterpretation);
  const toneHints = buildToneHints(styleProfile, userStateInterpretation);

  const responsePriorities = [...RESPONSE_PRIORITY_ORDER];
  if (archetypeGuide?.priorities?.length) {
    responsePriorities.push(...archetypeGuide.priorities.map((p) => `型:${p}`));
  }

  return {
    stylePrinciples: CORE_STYLE_PRINCIPLES,
    userStateInterpretation,
    responsePriorities,
    avoidPatterns: AVOID_PATTERNS,
    smallNextStepCandidates,
    safetyNotes,
    toneHints,
    conversationArchetype: archetype,
    archetypeGuidance: archetypeGuide,
    thinkingFlow: THINKING_FLOW,
    styleProfileSignals: {
      anxietyProne: Boolean(styleProfile.anxietyProne),
      weightSensitive: Boolean(styleProfile.weightSensitive),
      wantsDetailedNumbers: Boolean(styleProfile.wantsDetailedNumbers),
    },
  };
}

function formatHintsForPrompt(hints) {
  if (!hints || typeof hints !== 'object') return '';
  const lines = [
    '[AI牛込 会話判断 — 返信文の型ではなく思考順]',
    'あなたは定型返信Botではない。牛込先生の観察力・具体性・思いやり・安全意識を、ChatGPTの自然さで反映するLINE伴走者。',
    '',
    '守ること:',
    '- 今の発話の一番大事な部分に最初に反応',
    '- 数値だけで終わらない',
    '- できている行動を具体的に拾う',
    '- 食べすぎ・失敗・体重増を責めない',
    '- 次の一手は小さく',
    '- 痛み・体調不良は成果より安全',
    '- 安定習慣は崩さない（根拠なく「安定」と言い切らない）',
    '- 生活背景を拾う',
    '- 医療診断・治療断定しない',
    '- 定型の安心文を貼らない',
    '- LINEは基本短め',
    '',
    `判断順: ${(hints.thinkingFlow || THINKING_FLOW).join(' → ')}`,
    `優先順: ${(hints.responsePriorities || []).slice(0, 7).join(' > ')}`,
  ];
  if (hints.userStateInterpretation) {
    const u = hints.userStateInterpretation;
    lines.push(`いまの見方: 感情=${u.primaryEmotion || 'neutral'}, 安全=${u.safetyLevel || 'normal'}, まず=${(u.focusFirst || []).join('・')}`);
  }
  if (hints.conversationArchetype && hints.archetypeGuidance) {
    lines.push(`会話型ヒント: ${hints.archetypeGuidance.label}（個人名は使わない）`);
  }
  if (hints.smallNextStepCandidates?.length) {
    lines.push(`次の一手の候補（そのままコピーせず文脈で1つ）: ${hints.smallNextStepCandidates.join(' / ')}`);
  }
  if (hints.safetyNotes?.length) {
    lines.push(`安全: ${hints.safetyNotes.join(' / ')}`);
  }
  if (hints.avoidPatterns?.length) {
    lines.push(`避ける: ${hints.avoidPatterns.slice(0, 5).join('；')}`);
  }
  return lines.join('\n');
}

module.exports = {
  ARCHETYPE,
  buildUshigomeStyleHints,
  formatHintsForPrompt,
  inferThemes,
  inferArchetype,
};
