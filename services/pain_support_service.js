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

  const high = Boolean(swelling || bruising || numbness || restPain || nightPain || internalPossible || trauma);

  return {
    swelling,
    bruising,
    numbness,
    restPain,
    nightPain,
    trauma,
    internalPossible,
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
    redFlags.nightPain
  ) {
    return 'red_flag';
  }

  if (
    includesAny(t, ['歩くと痛い', '動くと痛い', 'つらい', '辛い', '数日', '何日も', 'まだ痛い']) ||
    onsetType === 'overuse' ||
    onsetType === 'gradual'
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

function buildQuickRepliesForLevel(level, symptomType) {
  if (level === 'red_flag') {
    return ['牛込先生に相談したい', '動画で見たい', '今日はここまで'];
  }

  if (symptomType === 'cramp') {
    return ['ストレッチしたい', '動画で見たい', '牛込先生に相談したい', '今日はここまで'];
  }

  return ['ストレッチしたい', '動画で見たい', '1分メニュー', '今日はここまで'];
}

function buildAreaSupportText(area, areaGroup, symptomType, level) {
  if (symptomType === 'cramp') {
    if (area === 'ふくらはぎ') {
      return {
        message: 'ふくらはぎがつる感じなら、まず強く動かすより、やさしく戻す方向が安心です。',
        avoid: '急に踏ん張る動きや強い運動は今日は控えめがよさそうです。',
        alternative: '落ち着いているなら、軽く伸ばす、水分を意識する、夜なら予防ストレッチが合いやすいです。',
      };
    }

    if (area === '足底' || area === 'かかと' || area === '足指') {
      return {
        message: '足まわりがつる感じなら、無理に踏ん張らず、まず力を抜く方向が安心です。',
        avoid: '急な歩き出しや強い踏み込みは今日は控えめがよさそうです。',
        alternative: '足指や足裏をやさしくゆるめるくらいからが進めやすいです。',
      };
    }

    return {
      message: 'つる感じがあるなら、まず強く動かさず、やさしく戻す方向が安心です。',
      avoid: '勢いをつけた運動は今日は控えめがよさそうです。',
      alternative: '落ち着いているなら、軽いストレッチと水分を意識するのが合いやすいです。',
    };
  }

  if (area === '足底') {
    return {
      message: '足底なら、足裏に負担が集まりやすい場所なので、今日は無理に踏み込まない方が安心です。',
      avoid: 'ジョギングや長く歩く動きは控えめがよさそうです。',
      alternative: 'その代わり、上半身中心や、足に体重をかけすぎない整え方なら進めやすいです。',
    };
  }

  if (area === 'かかと') {
    return {
      message: 'かかと寄りの痛みなら、着地の負担を増やしすぎない方が安心です。',
      avoid: '走る、ジャンプ、長歩きは今日は控えめがよさそうです。',
      alternative: '上半身中心か、座ってできる軽い運動の方が進めやすいです。',
    };
  }

  if (area === '膝') {
    return {
      message: '膝なら、深く曲げる動きや勢いの強い動きは今日は控えめが安心です。',
      avoid: '深いしゃがみ、ジャンプ、強い踏み込みは避けたいです。',
      alternative: '上半身中心や、膝に負担の少ない軽い調整なら進めやすいです。',
    };
  }

  if (area === '腰') {
    return {
      message: '腰なら、今日は頑張って鍛えるより守る方を優先したいです。',
      avoid: '強い体幹トレやひねりは控えめがよさそうです。',
      alternative: '呼吸を整える、軽くゆるめる、無理のない範囲で動く方向が合いやすいです。',
    };
  }

  if (area === '股関節') {
    return {
      message: '股関節なら、大きく開く動きや深い曲げ伸ばしは今日は慎重が安心です。',
      avoid: '深いしゃがみや反動のある動きは控えめがよさそうです。',
      alternative: '上半身中心か、小さい動きで整える方向が進めやすいです。',
    };
  }

  if (area === '肩' || area === '首') {
    return {
      message: `${area}まわりなら、無理に大きく動かすより軽く整える方向が安心です。`,
      avoid: '腕を高く上げる動きや強い負荷は今日は控えめがよさそうです。',
      alternative: '下半身の軽い運動や、呼吸を整える方向の方が進めやすいです。',
    };
  }

  if (area === 'ふくらはぎ') {
    return {
      message: 'ふくらはぎなら、踏ん張りすぎや急な負荷は今日は控えめが安心です。',
      avoid: '急に走る、強く蹴る動きは避けたいです。',
      alternative: '軽くゆるめる、上半身中心に寄せる方向が進めやすいです。',
    };
  }

  if (areaGroup === 'lower') {
    return {
      message: '下半身に負担がありそうなので、今日はその場所を守る方向が安心です。',
      avoid: '下半身に強く負荷がかかる動きは控えめがよさそうです。',
      alternative: '上半身中心や、座ってできる軽い方法なら進めやすいです。',
    };
  }

  if (areaGroup === 'upper') {
    return {
      message: '上半身に負担がありそうなので、今日はそこを守る方向が安心です。',
      avoid: '上半身に強く負荷がかかる動きは控えめがよさそうです。',
      alternative: '下半身の軽い運動や歩く方向の方が進めやすいです。',
    };
  }

  if (areaGroup === 'trunk') {
    return {
      message: '体幹まわりなら、今日は無理に頑張るより守る方向が安心です。',
      avoid: '強い体幹負荷やひねりは控えめがよさそうです。',
      alternative: '呼吸や軽い調整くらいからが合いやすいです。',
    };
  }

  return {
    message: '今日は無理を広げすぎず、やさしく整える方向が安心です。',
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

  if (redFlags.numbness) {
    return '痛みだけでなく、しびれに近い要素も少し気になります。ピリピリ感や力の入りにくさがあるなら、運動を進める前に一度相談する方が安全です。';
  }

  if (redFlags.restPain || redFlags.nightPain) {
    return '安静時や夜もつらいなら、自己判断で運動を進めすぎない方が安心です。まずは専門家に相談できると安全です。';
  }

  return CONSULT_MESSAGE;
}

function buildPainSupportResponse(text, area = null) {
  const areaDetail = area || detectPainArea(text);
  const areaGroup = detectAreaGroup(areaDetail);
  const symptomType = detectSymptomType(text);
  const onsetType = detectOnsetType(text);
  const redFlags = detectRedFlags(text);
  const painTrigger = detectPainTrigger(text);
  const level = triagePainLevel({ symptomType, onsetType, redFlags, text });

  const support = buildAreaSupportText(areaDetail, areaGroup, symptomType, level);
  const quickReplies = buildQuickRepliesForLevel(level, symptomType);

  if (level === 'red_flag') {
    const message = [
      `${areaDetail === '全身' ? '体の負担' : `${areaDetail}の負担`}が少し気になります。`,
      buildConsultPrompt(redFlags, symptomType),
    ].join('\n');

    return {
      message,
      quickReplies,
      context: {
        symptom_type: symptomType,
        area_group: areaGroup,
        area_detail: areaDetail,
        severity_level: 'high',
        onset_type: onsetType,
        pain_trigger: painTrigger,
        red_flag_level: 'high',
        red_flags: redFlags,
        support_mode: 'consult',
      },
    };
  }

  if (level === 'careful') {
    let followQuestion = '今日は無理を広げすぎない方が安心です。';

    if (onsetType === 'trauma') {
      followQuestion = '腫れや内出血があるなら、まずは相談を優先したいです。';
    } else if (symptomType === 'numbness') {
      followQuestion = 'ピリピリ感や力の入りにくさがあるなら、無理に進めず相談できると安心です。';
    } else if (symptomType === 'cramp') {
      followQuestion = '今つっているなら、まず止めてやさしく戻す方向が安心です。';
    } else if (painTrigger === 'rest' || painTrigger === 'night') {
      followQuestion = 'じっとしていてもつらいなら、自己判断で進めすぎない方が安心です。';
    } else {
      followQuestion = support.alternative;
    }

    const message = [
      support.message,
      support.avoid,
      followQuestion,
    ].join('\n');

    return {
      message,
      quickReplies,
      context: {
        symptom_type: symptomType,
        area_group: areaGroup,
        area_detail: areaDetail,
        severity_level: 'moderate',
        onset_type: onsetType,
        pain_trigger: painTrigger,
        red_flag_level: 'medium',
        red_flags: redFlags,
        support_mode: symptomType === 'cramp' ? 'stretch' : 'exercise_alternative',
      },
    };
  }

  const message = [
    support.message,
    support.avoid,
    support.alternative,
  ].join('\n');

  return {
    message,
    quickReplies,
    context: {
      symptom_type: symptomType,
      area_group: areaGroup,
      area_detail: areaDetail,
      severity_level: 'light',
      onset_type: onsetType,
      pain_trigger: painTrigger,
      red_flag_level: 'low',
      red_flags: redFlags,
      support_mode: symptomType === 'cramp' ? 'stretch' : 'exercise_alternative',
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
  ];

  return lines.join('\n');
}

module.exports = {
  CONSULT_MESSAGE,
  isPainLikeText,
  isStretchIntent,
  detectPainArea,
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
