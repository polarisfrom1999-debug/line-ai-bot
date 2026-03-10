const CONSULT_MESSAGE = '無理はしないでくださいね。つらそうなときや急な痛みは、直接牛込先生に相談してください。';

function detectPainArea(text) {
  const t = String(text || '');

  if (/腰|ぎっくり腰|腰痛/.test(t)) return '腰';
  if (/膝|ひざ/.test(t)) return '膝';
  if (/股関節|そけい|鼠径/.test(t)) return '股関節';
  if (/肩|五十肩|四十肩/.test(t)) return '肩';
  if (/首|頚|くび/.test(t)) return '首';
  if (/足首/.test(t)) return '足首';
  if (/ふくらはぎ/.test(t)) return 'ふくらはぎ';
  if (/背中/.test(t)) return '背中';
  return '全身';
}

function detectPainType(text) {
  const t = String(text || '');

  if (/しびれ|痺れ/.test(t)) return 'しびれ';
  if (/硬い|かたい|重い|重だるい|だるい/.test(t)) return '硬さ・重だるさ';
  return '痛み';
}

function isUrgentPainText(text) {
  const t = String(text || '');

  return [
    '急に',
    '激痛',
    'かなり痛い',
    'すごく痛い',
    '眠れない',
    '歩けない',
    '立てない',
    '力が入らない',
    'しびれが強い',
    'しびれがひどい',
    '腫れている',
    '腫れた',
    '夜も痛い',
  ].some((w) => t.includes(w));
}

function isPainLikeText(text) {
  const t = String(text || '');

  return [
    '痛い',
    'いたい',
    '痛み',
    'しびれ',
    '痺れ',
    '重い',
    '重だるい',
    'だるい',
    '張る',
    '違和感',
    'つらい',
    '辛い',
    '硬い',
    'かたい',
    '動かしづらい',
  ].some((w) => t.includes(w));
}

function isStretchIntent(text) {
  const t = String(text || '');

  return [
    'ストレッチ',
    '体操',
    'ほぐしたい',
    '伸ばしたい',
    '可動域',
    '柔らかくしたい',
  ].some((w) => t.includes(w));
}

function buildPainQuickReplies(area, urgent = false) {
  if (urgent) {
    return [
      '牛込先生に相談したい',
      '今日は休む',
      '落ち着いたらストレッチ',
    ];
  }

  if (area === '腰') {
    return ['朝から重い', '座るとつらい', '少し動くと楽', 'ストレッチしたい', '牛込先生に相談したい'];
  }
  if (area === '膝') {
    return ['歩くとつらい', '立ち上がりでつらい', '少し動くと楽', 'ストレッチしたい', '牛込先生に相談したい'];
  }
  if (area === '股関節') {
    return ['開くとつらい', '歩幅が出ない', '少し硬い', 'ストレッチしたい', '牛込先生に相談したい'];
  }
  if (area === '肩') {
    return ['上げるとつらい', '後ろに回しづらい', '少し動かしたい', 'ストレッチしたい', '牛込先生に相談したい'];
  }
  if (area === '首') {
    return ['振り向くとつらい', '重だるい', '肩も張る', 'ストレッチしたい', '牛込先生に相談したい'];
  }

  return ['少しつらい', '動くとつらい', '少し動くと楽', 'ストレッチしたい', '牛込先生に相談したい'];
}

function buildStretchQuickReplies(area) {
  if (area === '腰') {
    return ['腰まわりをやる', '股関節もやる', '1分だけやる', '今日は説明だけ'];
  }
  if (area === '膝') {
    return ['股関節をゆるめる', 'ふくらはぎを伸ばす', '1分だけやる', '今日は説明だけ'];
  }
  if (area === '股関節') {
    return ['股関節を開く', 'お尻をゆるめる', '1分だけやる', '今日は説明だけ'];
  }
  if (area === '肩') {
    return ['肩まわりをほぐす', '胸を開く', '1分だけやる', '今日は説明だけ'];
  }
  if (area === '首') {
    return ['首肩をゆるめる', '胸を開く', '1分だけやる', '今日は説明だけ'];
  }

  return ['全身軽め', '股関節をやる', '肩まわりをやる', '今日は説明だけ'];
}

function buildPainSupportResponse(text, previousArea = null) {
  const area = previousArea || detectPainArea(text);
  const type = detectPainType(text);
  const urgent = isUrgentPainText(text);

  const opening = urgent
    ? `${area}の${type}が強そうですね。まずは無理をしないことを優先しましょう。`
    : `${area}の${type}があるんですね。今日は無理に頑張りすぎず、整える方向でいきましょう。`;

  const bridge = area === '股関節'
    ? '股関節まわりが整うと、歩きやすさや姿勢、代謝にもつながりやすいです。'
    : area === '膝'
      ? '膝まわりだけでなく、股関節やふくらはぎの動きが整うと、歩きやすさや活動量にもつながりやすいです。'
      : area === '腰'
        ? '腰まわりが少し動きやすくなると、姿勢や歩きやすさ、代謝にもつながりやすいです。'
        : area === '肩' || area === '首'
          ? '肩や首まわりが少し楽になると、姿勢や呼吸のしやすさにもつながりやすいです。'
          : '動きやすさが少しずつ整うと、活動量や代謝にもつながりやすいです。';

  const lines = [
    opening,
    urgent ? null : bridge,
    urgent ? CONSULT_MESSAGE : null,
  ].filter(Boolean);

  return {
    area,
    urgent,
    message: lines.join('\n'),
    quickReplies: buildPainQuickReplies(area, urgent),
  };
}

function buildStretchSupportResponse(area = '全身') {
  const message = area === '股関節'
    ? '股関節をやさしく広げていくと、歩きやすさや姿勢だけでなく、ダイエットの土台にもつながりやすいです。今日はやさしくいきましょう。'
    : area === '膝'
      ? '膝を直接頑張らせるより、股関節やふくらはぎも少し整えると楽になることがあります。無理のない範囲でいきましょう。'
      : area === '腰'
        ? '腰は頑張りすぎず、周りをやさしく動かしてあげると整いやすいです。少しずつで十分です。'
        : area === '肩'
          ? '肩まわりは少しほぐれてくると姿勢や呼吸にもつながりやすいです。軽くいきましょう。'
          : area === '首'
            ? '首肩まわりはやさしく動かすだけでも軽さにつながることがあります。今日は無理なくいきましょう。'
            : '軽いストレッチや体操でも、可動域が広がると動きやすさや代謝につながりやすいです。';

  return {
    area,
    message,
    quickReplies: buildStretchQuickReplies(area),
  };
}

function buildExerciseFollowupQuickReplies() {
  return ['今日はここまで', 'まだ少しやる', 'ストレッチしたい', '腰が重い', '股関節を整えたい'];
}

function buildMealFollowupQuickReplies(needsDrinkCorrection = false) {
  if (needsDrinkCorrection) {
    return ['この内容で食事保存', 'お茶です', '水です', 'ノンアルです', 'お酒です'];
  }

  return ['この内容で食事保存', '飲み物を訂正', '量を訂正', '食事をキャンセル'];
}

module.exports = {
  CONSULT_MESSAGE,
  isPainLikeText,
  isStretchIntent,
  isUrgentPainText,
  detectPainArea,
  buildPainSupportResponse,
  buildStretchSupportResponse,
  buildExerciseFollowupQuickReplies,
  buildMealFollowupQuickReplies,
};