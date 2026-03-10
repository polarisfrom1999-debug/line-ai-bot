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
  if (/太もも|もも/.test(t)) return '太もも';
  if (/背中/.test(t)) return '背中';
  return '全身';
}

function detectPainType(text) {
  const t = String(text || '');

  if (/しびれ|痺れ/.test(t)) return 'しびれ';
  if (/重い|重だるい|だるい|張る|張り/.test(t)) return '重だるさ';
  if (/硬い|かたい|固い/.test(t)) return '硬さ';
  if (/違和感/.test(t)) return '違和感';
  return '痛み';
}

function detectPainTiming(text) {
  const t = String(text || '');

  if (/急に|さっきから|突然/.test(t)) return 'acute';
  if (/朝から|朝は/.test(t)) return 'morning';
  if (/夜|夜中|寝ると|寝返り/.test(t)) return 'night';
  if (/ずっと|前から|慢性|いつも/.test(t)) return 'chronic';
  return 'unknown';
}

function detectAggravatingFactor(text) {
  const t = String(text || '');

  if (/歩くと|歩いて/.test(t)) return 'walking';
  if (/座ると|座って/.test(t)) return 'sitting';
  if (/立つと|立ち上がると|立ち上がり/.test(t)) return 'standing_up';
  if (/曲げると|かがむと/.test(t)) return 'bending';
  if (/伸ばすと|反ると/.test(t)) return 'extending';
  if (/上げると/.test(t)) return 'raising';
  if (/開くと/.test(t)) return 'opening';
  return 'unknown';
}

function detectReliefFactor(text) {
  const t = String(text || '');

  if (/少し動くと楽|動くと少し楽|歩くと楽/.test(t)) return 'move_relief';
  if (/休むと楽|横になると楽/.test(t)) return 'rest_relief';
  if (/温めると楽/.test(t)) return 'heat_relief';
  return 'unknown';
}

function isUrgentPainText(text) {
  const t = String(text || '');

  return [
    '急に',
    '激痛',
    'かなり痛い',
    'すごく痛い',
    '強く痛い',
    '眠れない',
    '夜も痛い',
    '歩けない',
    '立てない',
    '力が入らない',
    'しびれが強い',
    'しびれがひどい',
    'どんどん悪化',
    '悪化している',
    '腫れている',
    '腫れた',
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
    '張り',
    '違和感',
    'つらい',
    '辛い',
    '硬い',
    'かたい',
    '固い',
    '動かしづらい',
    '歩幅が出ない',
    '上がらない',
    '伸びない',
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
    '動かしたい',
    '整えたい',
  ].some((w) => t.includes(w));
}

function buildPainQuickReplies(area, urgent = false, type = '痛み') {
  if (urgent) {
    return [
      '牛込先生に相談したい',
      '今日は休む',
      '落ち着いたらストレッチ',
    ];
  }

  if (type === 'しびれ') {
    return [
      '少ししびれる',
      'しびれが広がる',
      '歩くとつらい',
      'ストレッチしたい',
      '牛込先生に相談したい',
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
  if (area === 'ふくらはぎ' || area === '足首') {
    return ['歩くとつらい', '張っている', '少し動くと楽', 'ストレッチしたい', '牛込先生に相談したい'];
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
  if (area === 'ふくらはぎ' || area === '足首') {
    return ['ふくらはぎを伸ばす', '足首を動かす', '1分だけやる', '今日は説明だけ'];
  }

  return ['全身軽め', '股関節をやる', '肩まわりをやる', '今日は説明だけ'];
}

function buildBridgeMessage(area, type, aggravating, relief) {
  if (type === 'しびれ') {
    return 'しびれは無理に我慢しすぎず、変化を丁寧に見ていくことが大事です。強くなるときは早めに直接相談してください。';
  }

  if (area === '股関節') {
    return '股関節まわりが整うと、歩きやすさや姿勢、代謝にもつながりやすいです。';
  }

  if (area === '膝') {
    return '膝まわりだけでなく、股関節やふくらはぎの動きが整うと、歩きやすさや活動量にもつながりやすいです。';
  }

  if (area === '腰') {
    if (aggravating === 'sitting') {
      return '同じ姿勢で固まりやすくなっているかもしれません。軽く動きを作るだけでも楽になりやすいです。';
    }
    if (relief === 'move_relief') {
      return '少し動くと楽になるなら、固まりすぎないようにやさしく動かす方向が合いそうです。';
    }
    return '腰まわりが少し動きやすくなると、姿勢や歩きやすさ、代謝にもつながりやすいです。';
  }

  if (area === '肩' || area === '首') {
    return '肩や首まわりが少し楽になると、姿勢や呼吸のしやすさにもつながりやすいです。';
  }

  if (area === 'ふくらはぎ' || area === '足首') {
    return 'ふくらはぎや足首が整うと、歩きやすさや膝への負担軽減にもつながりやすいです。';
  }

  return '動きやすさが少しずつ整うと、活動量や代謝にもつながりやすいです。';
}

function buildPainSupportResponse(text, previousArea = null) {
  const area = previousArea || detectPainArea(text);
  const type = detectPainType(text);
  const urgent = isUrgentPainText(text);
  const timing = detectPainTiming(text);
  const aggravating = detectAggravatingFactor(text);
  const relief = detectReliefFactor(text);

  const opening = urgent
    ? `${area}の${type}が強そうですね。まずは無理をしないことを優先しましょう。`
    : timing === 'chronic'
      ? `${area}の${type}が続いているんですね。今日は無理に頑張りすぎず、整える方向でいきましょう。`
      : `${area}の${type}があるんですね。今日は無理に頑張りすぎず、整える方向でいきましょう。`;

  const bridge = buildBridgeMessage(area, type, aggravating, relief);

  const lines = [
    opening,
    urgent ? null : bridge,
    urgent ? CONSULT_MESSAGE : null,
  ].filter(Boolean);

  return {
    area,
    type,
    urgent,
    aggravating,
    relief,
    message: lines.join('\n'),
    quickReplies: buildPainQuickReplies(area, urgent, type),
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
            : area === 'ふくらはぎ' || area === '足首'
              ? 'ふくらはぎや足首が少し動きやすくなると、歩きやすさや膝の負担軽減にもつながりやすいです。'
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