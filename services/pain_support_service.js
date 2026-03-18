'use strict';

const CONSULT_MESSAGE = '症状が気になる時や、無理をすると悪化しそうな時は、牛込先生にそのままLINEで相談してください。必要なら専門家への相談も考えましょう。';

function safeText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizeLoose(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[！!？?。.,，、]/g, '')
    .replace(/\s+/g, '');
}

function includesAny(text, words = []) {
  const t = normalizeLoose(text);
  return words.some((w) => t.includes(normalizeLoose(w)));
}

function uniq(list = []) {
  return Array.from(new Set((list || []).filter(Boolean)));
}

function detectPainArea(text) {
  const t = normalizeLoose(text);

  if (!t) return '全身';

  if (includesAny(t, ['足底腱膜炎', '足裏', '足の裏', '土踏まず'])) return '足底';
  if (includesAny(t, ['かかと', '踵'])) return 'かかと';
  if (includesAny(t, ['足首'])) return '足首';
  if (includesAny(t, ['ふくらはぎ'])) return 'ふくらはぎ';
  if (includesAny(t, ['すね'])) return 'すね';
  if (includesAny(t, ['足指', '足の指'])) return '足指';
  if (includesAny(t, ['太もも', 'もも', '腿'])) return '太もも';
  if (includesAny(t, ['膝', 'ひざ'])) return '膝';
  if (includesAny(t, ['股関節'])) return '股関節';
  if (includesAny(t, ['お尻', '臀部'])) return 'お尻';
  if (includesAny(t, ['腰'])) return '腰';
  if (includesAny(t, ['背中'])) return '背中';
  if (includesAny(t, ['胸'])) return '胸';
  if (includesAny(t, ['首'])) return '首';
  if (includesAny(t, ['肩', '肩甲骨'])) return '肩';
  if (includesAny(t, ['肘'])) return '肘';
  if (includesAny(t, ['手首'])) return '手首';
  if (includesAny(t, ['手指', '指'])) return '手指';

  return '全身';
}

function detectAreaGroup(area) {
  if (['足底', 'かかと', '足首', 'ふくらはぎ', 'すね', '足指', '太もも', '膝', '股関節', 'お尻'].includes(area)) {
    return 'lower';
  }
  if (['腰', '背中', '胸'].includes(area)) {
    return 'trunk';
  }
  if (['首', '肩', '肘', '手首', '手指'].includes(area)) {
    return 'upper';
  }
  return 'unknown';
}

function detectSymptomType(text) {
  const t = normalizeLoose(text);

  if (!t) return 'pain';

  if (includesAny(t, ['つる', 'つった', 'こむら返り'])) return 'cramp';
  if (includesAny(t, ['しびれ', 'ピリピリ', 'ジンジン', 'ビリビリ', '感覚が鈍い', '感覚がにぶい', '電気が走る', '力が入りにくい', '脱力'])) return 'numbness';
  if (includesAny(t, ['重い', '張る', 'はる', 'こわばる', '硬い', 'かたい'])) return 'stiffness';
  if (includesAny(t, ['息苦しい', '胸が苦しい', '発熱', 'むくみ', 'ふらつく', 'だるすぎる', '強い倦怠感'])) return 'internal_possible';

  return 'pain';
}

function detectOnsetType(text) {
  const t = normalizeLoose(text);

  if (includesAny(t, ['ぶつけた', 'ひねった', '転んだ', '捻挫', 'ぶつかった', '痛めた瞬間'])) return 'trauma';
  if (includesAny(t, ['使いすぎ', '歩きすぎ', '走りすぎ', 'やりすぎ', '立ちすぎ'])) return 'overuse';
  if (includesAny(t, ['気づいたら', 'いつのまにか', 'だんだん', '前から', '前々から', 'ずっと'])) return 'gradual';

  return 'unknown';
}

function detectRedFlags(text) {
  const t = normalizeLoose(text);

  const swelling = includesAny(t, ['腫れ', '腫れてる', 'はれてる']);
  const bruising = includesAny(t, ['内出血', '皮下出血', 'あざ', '青あざ', '紫']);
  const numbness = includesAny(t, ['しびれ', 'ピリピリ', 'ジンジン', 'ビリビリ', '感覚が鈍い', '力が入りにくい', '脱力']);
  const restPain = includesAny(t, ['じっとしてても痛い', '何もしなくても痛い', '安静でも痛い']);
  const nightPain = includesAny(t, ['夜も痛い', '夜に痛い', '寝ていても痛い']);
  const internalPossible = includesAny(t, ['息苦しい', '胸が苦しい', '発熱', 'むくみ', 'ふらつく', '強いだるさ', '強い倦怠感']);
  const trauma = detectOnsetType(t) === 'trauma';
  const severePain = includesAny(t, ['かなり痛い', 'すごく痛い', '激痛', '強く痛い']);
  const weakness = includesAny(t, ['力が入りにくい', '脱力', '力が入らない']);

  const high = Boolean(swelling || bruising || numbness || restPain || nightPain || internalPossible || trauma || severePain || weakness);

  return {
    swelling,
    bruising,
    numbness,
    restPain,
    nightPain,
    trauma,
    internalPossible,
    severePain,
    weakness,
    high,
  };
}

function detectPainTrigger(text) {
  const t = normalizeLoose(text);

  if (includesAny(t, ['歩くと痛い', '歩くと'])) return 'walk';
  if (includesAny(t, ['走ると痛い', '走ったら', 'ジョギング'])) return 'run';
  if (includesAny(t, ['しゃがむと', '深く曲げると'])) return 'squat';
  if (includesAny(t, ['階段'])) return 'stairs';
  if (includesAny(t, ['腕を上げると', '上げると'])) return 'raise_arm';
  if (includesAny(t, ['ひねると'])) return 'twist';
  if (includesAny(t, ['じっとしてても痛い', '安静でも痛い'])) return 'rest';
  if (includesAny(t, ['夜も痛い', '夜に痛い'])) return 'night';
  if (includesAny(t, ['少し動くと楽'])) return 'move_relief';

  return 'unknown';
}

function hasQuestionIntent(text) {
  const raw = String(text || '').trim();
  const t = normalizeLoose(raw);

  if (!t) return false;
  if (/[？?]/.test(raw)) return true;

  return includesAny(t, [
    'かな',
    'ですか',
    'ますか',
    'だめ',
    'ダメ',
    '大丈夫',
    '平気',
    'していい',
    'してもいい',
    'どうかな',
    'どうですか',
    '教えて',
  ]);
}

function triagePainLevel({ symptomType, onsetType, redFlags, text }) {
  const t = normalizeLoose(text);

  if (
    symptomType === 'internal_possible' ||
    redFlags.internalPossible ||
    redFlags.trauma ||
    redFlags.swelling ||
    redFlags.bruising ||
    redFlags.numbness ||
    redFlags.restPain ||
    redFlags.nightPain ||
    redFlags.severePain ||
    redFlags.weakness
  ) {
    return 'red_flag';
  }

  if (
    includesAny(t, ['歩くと痛い', '動くと痛い', 'つらい', '辛い', '数日', '何日も', 'まだ痛い']) ||
    onsetType === 'overuse' ||
    onsetType === 'gradual' ||
    hasQuestionIntent(t)
  ) {
    return 'careful';
  }

  return 'light';
}

function isPainLikeText(text) {
  return includesAny(text, [
    '痛い', '痛み', '違和感', 'つらい', '辛い', '重い', '張る', 'こわばる',
    '足底腱膜炎', '膝', '腰', '股関節', '肩', '首', 'かかと', '足裏', 'ふくらはぎ',
    'つる', 'しびれ'
  ]);
}

function isStretchIntent(text) {
  return includesAny(text, [
    'ストレッチ', '伸ばしたい', 'ほぐしたい', 'ゆるめたい', '整えたい'
  ]);
}

function buildQuickRepliesForLevel(level, symptomType, areaDetail) {
  if (level === 'red_flag') {
    return ['牛込先生に相談したい', '牛込先生に共有する', '今日はここまで'];
  }

  if (symptomType === 'cramp') {
    return ['今つっている', '今は落ち着いた', '夜によくつる', 'ストレッチしたい'];
  }

  if (areaDetail === '足底' || areaDetail === 'かかと') {
    return ['歩くと痛い', '少し動くと楽', 'ストレッチしたい', '動画で見たい'];
  }

  return ['ストレッチしたい', '動画で見たい', '1分メニュー', '今日はここまで'];
}

function buildAreaSupportText(area, areaGroup, symptomType) {
  if (symptomType === 'cramp') {
    if (area === 'ふくらはぎ') {
      return {
        primary: 'ふくらはぎがつる感じなら、まず強く動かすより、やさしく戻す方向が安心です。',
        avoid: '急に踏ん張る動きや強く蹴る動きは今日は控えめがよさそうです。',
        alternative: '今は落ち着いているなら、軽く伸ばす、水分を意識する、夜なら予防ストレッチが合いやすいです。',
      };
    }

    if (area === '足底' || area === 'かかと' || area === '足指') {
      return {
        primary: '足まわりがつる感じなら、まず無理に踏ん張らず、力を抜く方向が安心です。',
        avoid: '急な歩き出しや強い踏み込みは今日は控えめがよさそうです。',
        alternative: '足指や足裏をやさしくゆるめるくらいからが進めやすいです。',
      };
    }

    return {
      primary: 'つる感じがあるなら、まず強く動かさず、やさしく戻す方向が安心です。',
      avoid: '勢いをつけた運動は今日は控えめがよさそうです。',
      alternative: '落ち着いているなら、軽いストレッチと水分を意識するのが合いやすいです。',
    };
  }

  if (area === '足底') {
    return {
      primary: '足底なら、足裏とかかと内側寄りに負担が集まりやすい場所なので、今日は無理に踏み込まない方が安心です。',
      avoid: 'ジョギング、長歩き、ジャンプのような着地負荷は今日は控えめがよさそうです。',
      alternative: 'その代わり、上半身中心や、足に体重をかけすぎない整え方、ふくらはぎや足首をやさしくゆるめる方向なら進めやすいです。',
    };
  }

  if (area === 'かかと') {
    return {
      primary: 'かかと寄りの痛みなら、着地の負担を増やしすぎない方が安心です。',
      avoid: '走る、ジャンプ、長歩きは今日は控えめがよさそうです。',
      alternative: '上半身中心か、座ってできる軽い運動、足首まわりをやさしく整える方向が進めやすいです。',
    };
  }

  if (area === '足首') {
    return {
      primary: '足首なら、ひねりや踏ん張りの負担を増やしすぎない方が安心です。',
      avoid: '急な方向転換や強い踏み込みは今日は控えめがよさそうです。',
      alternative: '上半身中心か、足首に無理をかけない軽い方法の方が進めやすいです。',
    };
  }

  if (area === '膝') {
    return {
      primary: '膝なら、深く曲げる動きや勢いの強い動きは今日は控えめが安心です。',
      avoid: '深いしゃがみ、ジャンプ、強い踏み込みは避けたいです。',
      alternative: '上半身中心や、膝に負担の少ない軽い調整、股関節まわりをやさしく整える方向なら進めやすいです。',
    };
  }

  if (area === '腰') {
    return {
      primary: '腰なら、今日は頑張って鍛えるより守る方を優先したいです。',
      avoid: '強い体幹トレ、反動のある前屈、ひねりは控えめがよさそうです。',
      alternative: '呼吸を整える、軽くゆるめる、無理のない範囲で動く方向が合いやすいです。',
    };
  }

  if (area === '股関節') {
    return {
      primary: '股関節なら、大きく開く動きや深い曲げ伸ばしは今日は慎重が安心です。',
      avoid: '深いしゃがみや反動のある動きは控えめがよさそうです。',
      alternative: '上半身中心か、小さい動きで整える方向が進めやすいです。',
    };
  }

  if (area === '肩' || area === '首') {
    return {
      primary: `${area}まわりなら、無理に大きく動かすより軽く整える方向が安心です。`,
      avoid: '腕を高く上げる動きや強い負荷は今日は控えめがよさそうです。',
      alternative: '下半身の軽い運動や、呼吸を整える方向の方が進めやすいです。',
    };
  }

  if (area === 'ふくらはぎ') {
    return {
      primary: 'ふくらはぎなら、踏ん張りすぎや急な負荷は今日は控えめが安心です。',
      avoid: '急に走る、強く蹴る、強く踏み込む動きは避けたいです。',
      alternative: '軽くゆるめる、上半身中心に寄せる、落ち着いているならやさしいストレッチが進めやすいです。',
    };
  }

  if (areaGroup === 'lower') {
    return {
      primary: '下半身に負担がありそうなので、今日はその場所を守る方向が安心です。',
      avoid: '下半身に強く負荷がかかる動きは控えめがよさそうです。',
      alternative: '上半身中心や、座ってできる軽い方法なら進めやすいです。',
    };
  }

  if (areaGroup === 'upper') {
    return {
      primary: '上半身に負担がありそうなので、今日はそこを守る方向が安心です。',
      avoid: '上半身に強く負荷がかかる動きは控えめがよさそうです。',
      alternative: '下半身の軽い運動や歩く方向の方が進めやすいです。',
    };
  }

  if (areaGroup === 'trunk') {
    return {
      primary: '体幹まわりなら、今日は無理に頑張るより守る方向が安心です。',
      avoid: '強い体幹負荷やひねりは控えめがよさそうです。',
      alternative: '呼吸や軽い調整くらいからが合いやすいです。',
    };
  }

  return {
    primary: '今日は無理を広げすぎず、やさしく整える方向が安心です。',
    avoid: '強い負荷は控えめがよさそうです。',
    alternative: '軽い運動やストレッチから進めるのが合いやすいです。',
  };
}

function buildConsultPrompt(redFlags, symptomType) {
  if (symptomType === 'internal_possible' || redFlags.internalPossible) {
    return 'ここでは断定できませんが、運動器だけではなく他の要因も含めて見た方がよい可能性があります。まずは専門家に相談してください。必要なら牛込先生にも共有してください。';
  }

  if (redFlags.trauma && (redFlags.swelling || redFlags.bruising)) {
    return 'きっかけがあって、さらに腫れや内出血があるなら、まず外傷として慎重に見たいです。無理に動かす前に、牛込先生を含めて専門家に相談するのがおすすめです。';
  }

  if (redFlags.trauma) {
    return 'きっかけがあって痛めた感じなら、まず外傷として慎重に見たいです。無理に動かしたり強く伸ばしたりする前に、相談できると安心です。';
  }

  if (redFlags.numbness || redFlags.weakness) {
    return '痛みだけでなく、しびれに近い要素や力の入りにくさも少し気になります。運動を進める前に一度相談する方が安全です。';
  }

  if (redFlags.restPain || redFlags.nightPain) {
    return '安静時や夜もつらいなら、自己判断で運動を進めすぎない方が安心です。まずは専門家に相談できると安全です。';
  }

  return CONSULT_MESSAGE;
}

function buildCarefulQuestion({ symptomType, onsetType, redFlags, areaDetail }) {
  if (onsetType === 'trauma') {
    return {
      text: '腫れや内出血はありますか？',
      quickReplies: ['腫れあり', '内出血あり', 'どちらもない', 'わからない'],
      reason: '外傷確認',
    };
  }

  if (symptomType === 'numbness') {
    return {
      text: 'ピリピリ感や力の入りにくさはありますか？',
      quickReplies: ['ピリピリする', '力が入りにくい', 'しびれはない', '少し気になる'],
      reason: 'しびれ確認',
    };
  }

  if (symptomType === 'cramp') {
    return {
      text: '今つっていますか？ それとも今は落ち着いていますか？',
      quickReplies: ['今つっている', '今は落ち着いた', '夜によくつる', '歩くとつりそう'],
      reason: 'つり確認',
    };
  }

  if (redFlags.restPain || redFlags.nightPain) {
    return {
      text: 'じっとしていても痛い感じですか？ それとも動く時が中心ですか？',
      quickReplies: ['じっとしても痛い', '動くと痛い', '夜も痛い', '少し動くと楽'],
      reason: '痛み方確認',
    };
  }

  if (areaDetail === '足底' || areaDetail === 'かかと' || areaDetail === '膝' || areaDetail === '腰') {
    return {
      text: '近いものを選ぶとしたらどれですか？',
      quickReplies: ['歩くと痛い', '動くと痛い', 'じっとしても痛い', '少し動くと楽'],
      reason: '負荷確認',
    };
  }

  return {
    text: '今日は動くとつらい感じですか？ それとも少し動くと楽ですか？',
    quickReplies: ['動くとつらい', '少し動くと楽', 'じっとしても痛い', 'よくわからない'],
    reason: '状態確認',
  };
}

function buildSuggestedActions({ level, symptomType, areaGroup, areaDetail, redFlags }) {
  if (level === 'red_flag') {
    return uniq([
      '牛込先生に相談する',
      '無理な運動は控える',
      redFlags.internalPossible ? '専門家に相談する' : null,
      redFlags.trauma ? 'まず患部を守る' : null,
    ]);
  }

  if (symptomType === 'cramp') {
    return uniq([
      '強く動かさず落ち着かせる',
      'やさしいストレッチを見る',
      '水分を意識する',
      '夜なら予防ストレッチを試す',
    ]);
  }

  if (areaGroup === 'lower') {
    return uniq([
      '下半身の負荷を下げる',
      '上半身中心の軽い運動に切り替える',
      areaDetail === '足底' || areaDetail === 'かかと' ? '足首やふくらはぎをやさしく整える' : null,
      '必要なら動画で確認する',
    ]);
  }

  if (areaGroup === 'upper') {
    return uniq([
      '上半身の負荷を下げる',
      '下半身中心の軽い運動に切り替える',
      '呼吸を整える',
      '必要なら動画で確認する',
    ]);
  }

  if (areaGroup === 'trunk') {
    return uniq([
      '体幹の強い負荷は控える',
      '呼吸や軽い調整を優先する',
      '今日は軽めで進める',
      '必要なら動画で確認する',
    ]);
  }

  return uniq([
    '今日は軽めにする',
    'やさしいストレッチを試す',
    '必要なら動画で確認する',
  ]);
}

function buildFollowupHint({ level, areaDetail, symptomType, areaGroup }) {
  if (level === 'red_flag') {
    return `${areaDetail}の負担は慎重に見たいので、無理を広げないように気にかける。`;
  }

  if (symptomType === 'cramp') {
    return `${areaDetail}のつりは、強い負荷を避けつつ、水分とやさしいストレッチを時々気にかける。`;
  }

  if (areaGroup === 'lower') {
    return `${areaDetail}に負担をかけすぎない範囲で進めるよう、時々軽く気にかける。`;
  }

  if (areaGroup === 'upper') {
    return `${areaDetail}の負担を増やしすぎないよう、上半身の無理を時々軽く気にかける。`;
  }

  if (areaGroup === 'trunk') {
    return `${areaDetail}は守りながら進めるよう、強い負荷を避ける一言を時々返す。`;
  }

  return '無理を広げすぎないよう、時々軽く気にかける。';
}

function buildThreeStepFlow({ level, symptomType, onsetType, redFlags, areaDetail, areaGroup }) {
  const step1 = {
    label: '今の返答',
    action: level === 'red_flag' ? '相談優先で返す' : '部位別に負担回避と代替案を返す',
  };

  let step2;
  if (level === 'light') {
    step2 = {
      label: '次に進めること',
      action: symptomType === 'cramp' ? 'ストレッチか動画案内へ進む' : '軽い運動やストレッチ提案へ進む',
    };
  } else if (level === 'careful') {
    step2 = {
      label: '次に確認すること',
      action: buildCarefulQuestion({ symptomType, onsetType, redFlags, areaDetail }).reason,
    };
  } else {
    step2 = {
      label: '次に確認すること',
      action: '相談導線と共有導線を優先する',
    };
  }

  let step3;
  if (level === 'red_flag') {
    step3 = {
      label: 'その次の対応',
      action: '牛込先生相談または専門家相談へつなぐ',
    };
  } else if (areaGroup === 'lower') {
    step3 = {
      label: 'その次の提案',
      action: '上半身中心・座位中心・やさしいストレッチへつなぐ',
    };
  } else if (areaGroup === 'upper') {
    step3 = {
      label: 'その次の提案',
      action: '下半身中心・歩行・軽運動へつなぐ',
    };
  } else if (areaGroup === 'trunk') {
    step3 = {
      label: 'その次の提案',
      action: '呼吸・軽い調整・休息寄りへつなぐ',
    };
  } else {
    step3 = {
      label: 'その次の提案',
      action: 'やさしい方法や動画へつなぐ',
    };
  }

  return { step1, step2, step3 };
}

function buildPainSupportResponse(text, area = null) {
  const rawText = safeText(text, 300);
  const areaDetail = area || detectPainArea(text);
  const areaGroup = detectAreaGroup(areaDetail);
  const symptomType = detectSymptomType(text);
  const onsetType = detectOnsetType(text);
  const redFlags = detectRedFlags(text);
  const painTrigger = detectPainTrigger(text);
  const level = triagePainLevel({ symptomType, onsetType, redFlags, text });

  const support = buildAreaSupportText(areaDetail, areaGroup, symptomType);
  const quickReplies = buildQuickRepliesForLevel(level, symptomType, areaDetail);
  const carefulQuestion = buildCarefulQuestion({ symptomType, onsetType, redFlags, areaDetail });
  const suggestedActions = buildSuggestedActions({ level, symptomType, areaGroup, areaDetail, redFlags });
  const followupHint = buildFollowupHint({ level, areaDetail, symptomType, areaGroup });
  const threeStepFlow = buildThreeStepFlow({ level, symptomType, onsetType, redFlags, areaDetail, areaGroup });

  let message = '';
  let nextStep = 'suggest';
  let nextQuestion = null;
  let supportMode = symptomType === 'cramp' ? 'stretch' : 'exercise_alternative';

  if (level === 'red_flag') {
    message = [
      `${areaDetail === '全身' ? '体の負担' : `${areaDetail}の負担`}が少し気になります。`,
      buildConsultPrompt(redFlags, symptomType),
    ].join('\n');

    nextStep = 'consult';
    nextQuestion = carefulQuestion;
    supportMode = 'consult';
  } else if (level === 'careful') {
    if (hasQuestionIntent(text)) {
      message = [
        support.primary,
        support.avoid,
        support.alternative,
      ].join('\n');
      nextStep = 'suggest_after_light_confirm';
      nextQuestion = carefulQuestion;
    } else {
      message = [
        support.primary,
        support.avoid,
        support.alternative,
      ].join('\n');
      nextStep = 'ask_one';
      nextQuestion = carefulQuestion;
    }
  } else {
    message = [
      support.primary,
      support.avoid,
      support.alternative,
    ].join('\n');

    nextStep = symptomType === 'cramp' ? 'suggest_stretch' : 'suggest';
    nextQuestion = null;
  }

  const aiGuidance = safeText(message, 250);

  return {
    message,
    quickReplies,
    next_step: nextStep,
    next_question: nextQuestion,
    suggested_actions: suggestedActions,
    followup_hint: followupHint,
    three_step_flow: threeStepFlow,
    context: {
      raw_text: rawText,
      symptom_type: symptomType,
      area_group: areaGroup,
      area_detail: areaDetail,
      severity_level: level === 'light' ? 'light' : level === 'careful' ? 'moderate' : 'high',
      onset_type: onsetType,
      pain_trigger: painTrigger,
      red_flag_level: level === 'red_flag' ? 'high' : level === 'careful' ? 'medium' : 'low',
      red_flags: redFlags,
      support_mode: supportMode,
      next_step: nextStep,
      followup_hint: followupHint,
      ai_guidance: aiGuidance,
    },
  };
}

function buildStretchSupportResponse(area = '全身') {
  if (area === '足底' || area === 'かかと') {
    return {
      message: [
        '今日は足裏やかかとに体重をかけすぎない範囲でいきましょう。',
        '足裏そのものを強く攻めるより、ふくらはぎや足首をやさしくゆるめるくらいが合いやすいです。',
      ].join('\n'),
      quickReplies: ['動画で見たい', '1分メニュー', '今日はここまで'],
    };
  }

  if (area === '膝') {
    return {
      message: [
        '膝は深く曲げすぎず、まずは周りを軽く整える方向が安心です。',
        '股関節や太ももをやさしくゆるめるくらいからが進めやすいです。',
      ].join('\n'),
      quickReplies: ['動画で見たい', '1分メニュー', '今日はここまで'],
    };
  }

  if (area === '腰') {
    return {
      message: [
        '腰は今日は強く伸ばすより、呼吸を整えて軽くゆるめるくらいが安心です。',
        '無理のない範囲でいきましょう。',
      ].join('\n'),
      quickReplies: ['動画で見たい', '1分メニュー', '今日はここまで'],
    };
  }

  if (area === 'ふくらはぎ') {
    return {
      message: [
        'ふくらはぎは強く反動をつけず、やさしくゆるめるくらいが安心です。',
        'つる感じが残る時は、急に踏ん張らない方向でいきましょう。',
      ].join('\n'),
      quickReplies: ['動画で見たい', '1分メニュー', '今日はここまで'],
    };
  }

  return {
    message: [
      '今日は無理に強く伸ばさず、やさしく整える方向でいきましょう。',
      '軽くゆるめるくらいで十分です。',
    ].join('\n'),
    quickReplies: ['動画で見たい', '1分メニュー', '今日はここまで'],
  };
}

function buildExerciseFollowupQuickReplies() {
  return ['ストレッチしたい', '動画で見たい', '1分メニュー', '今日はここまで'];
}

function buildAdminSymptomSummary(context = {}) {
  const redFlags = context.red_flags || {};

  const lines = [
    '牛込先生共有用',
    `主訴: ${safeText(context.raw_text || '症状相談', 120)}`,
    `部位: ${safeText(context.area_detail || '不明', 60)}`,
    `分類: ${safeText(context.symptom_type || 'pain', 40)}`,
    `発生機序: ${safeText(context.onset_type || 'unknown', 40)}`,
    `痛みの出方: ${safeText(context.pain_trigger || 'unknown', 40)}`,
    `腫れ: ${redFlags.swelling ? 'あり' : 'なし/不明'}`,
    `内出血: ${redFlags.bruising ? 'あり' : 'なし/不明'}`,
    `しびれ: ${redFlags.numbness ? 'あり/疑い' : 'なし/不明'}`,
    `危険度: ${safeText(context.red_flag_level || 'low', 20)}`,
    `AI案内: ${safeText(context.ai_guidance || '負担を下げる方向を案内', 200)}`,
    context.followup_hint ? `フォロー方針: ${safeText(context.followup_hint, 120)}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}

module.exports = {
  CONSULT_MESSAGE,
  isPainLikeText,
  isStretchIntent,
  detectPainArea,
  detectAreaGroup,
  detectSymptomType,
  detectOnsetType,
  detectRedFlags,
  detectPainTrigger,
  triagePainLevel,
  buildPainSupportResponse,
  buildStretchSupportResponse,
  buildExerciseFollowupQuickReplies,
  buildAdminSymptomSummary,
};
