'use strict';

function normalizeText(value) {
  return String(value || '').trim();
}

function pickFirstNonEmpty(values) {
  for (const value of values) {
    const safe = normalizeText(value);
    if (safe) return safe;
  }
  return '';
}

function round1(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 10) / 10;
}

function countSignals(text, regex) {
  return (normalizeText(text).match(regex) || []).length;
}

function joinUserMessages(recentMessages) {
  return (Array.isArray(recentMessages) ? recentMessages : [])
    .filter((m) => m?.role === 'user')
    .map((m) => normalizeText(m.content))
    .join('\n');
}

function getSeasonInJapan(date = new Date()) {
  const month = Number(new Intl.DateTimeFormat('en-US', { month: 'numeric', timeZone: 'Asia/Tokyo' }).format(date));
  if ([12, 1, 2].includes(month)) return 'winter';
  if ([3, 4, 5].includes(month)) return 'spring';
  if ([6, 7, 8].includes(month)) return 'summer';
  return 'autumn';
}

function inferConditionProfile(params = {}) {
  const longMemory = params.longMemory || {};
  const userState = params.userState || {};
  const todayRecords = params.todayRecords || {};
  const joinedText = joinUserMessages(params.recentMessages);
  const bodySignals = Array.isArray(longMemory.bodySignals) ? longMemory.bodySignals.join(' ') : '';
  const lifeContext = Array.isArray(longMemory.lifeContext) ? longMemory.lifeContext.join(' ') : '';
  const mergedText = [joinedText, bodySignals, lifeContext, normalizeText(params.contextText)].join('\n');

  const fatigueScore = countSignals(mergedText, /疲れた|だるい|しんどい|寝不足|眠い/g) + (Number(userState?.gasolineScore || 5) <= 4 ? 1 : 0);
  const swellingScore = countSignals(mergedText, /むくみ|浮腫/g);
  const constipationScore = countSignals(mergedText, /便秘|便通がない|出てない/g);
  const painScore = countSignals(mergedText, /痛い|痛み|腰痛|首|肩こり|しびれ/g);
  const lowWaterScore = countSignals(mergedText, /水分少ない|水飲めてない|喉乾く/g);
  const stressEatingScore = countSignals(mergedText, /食べすぎ|止まらない|イライラ|ストレス/g);

  const mealCount = Array.isArray(todayRecords.meals) ? todayRecords.meals.length : 0;
  const recentProtein = (Array.isArray(todayRecords.meals) ? todayRecords.meals : []).reduce((sum, meal) => {
    return sum + Number(meal?.protein || meal?.estimatedNutrition?.protein || 0);
  }, 0);

  return {
    preferredName: longMemory.preferredName || '',
    aiType: normalizeText(longMemory.aiType || params.aiType),
    constitutionType: normalizeText(longMemory.constitutionType || params.constitutionType),
    supportPreference: Array.isArray(longMemory.supportPreference) ? longMemory.supportPreference : [],
    stagnationTendency: normalizeText(longMemory.stagnationTendency),
    season: params.season || getSeasonInJapan(),
    fatigueScore,
    swellingScore,
    constipationScore,
    painScore,
    lowWaterScore,
    stressEatingScore,
    mealCount,
    recentProtein: round1(recentProtein),
    mergedText
  };
}

function getPlanTemplates() {
  return [
    {
      id: 'recovery_soup',
      title: '回復優先の汁物セット',
      when: '疲れが強い日',
      tags: ['疲労', 'やさしい', '温かい'],
      match: (c) => c.fatigueScore >= 2 || c.painScore >= 1,
      meals: [
        '主菜: 豆腐・鶏むね・卵のどれかを入れたスープ',
        '主食: ごはん少なめ 1杯',
        '副菜: カット野菜か冷凍野菜をそのまま足す'
      ],
      aim: '消化の負担を上げすぎず、たんぱく質と温かさを入れて整える形です。'
    },
    {
      id: 'water_balance',
      title: 'むくみケアの軽め定食',
      when: 'むくみや重さが気になる日',
      tags: ['むくみ', '整える', '塩分ケア'],
      match: (c) => c.swellingScore >= 1,
      meals: [
        '主菜: 焼き魚かサラダチキン',
        '主食: ごはん 1杯',
        '副菜: きゅうり・海藻・きのこ系を1品',
        '飲み物: 水か温かいお茶をこまめに'
      ],
      aim: '濃い味に寄せすぎず、水分を戻しながら体の重さを抜きやすくします。'
    },
    {
      id: 'bowel_support',
      title: '便通サポートの朝寄せプラン',
      when: '便通が気になる日',
      tags: ['便通', '朝', '発酵食品'],
      match: (c) => c.constipationScore >= 1,
      meals: [
        '朝: ヨーグルト + バナナ + 水',
        '昼: 納豆ごはん or そば',
        '夜: 野菜スープか鍋系を1品'
      ],
      aim: '朝の水分と発酵食品、温かいものをつなげて動きを作りやすくする形です。'
    },
    {
      id: 'protein_anchor',
      title: 'たんぱく質アンカー型',
      when: '食事はしているけれど中身を整えたい日',
      tags: ['たんぱく質', '安定', '基本形'],
      match: (c) => c.recentProtein < 45 || c.mealCount <= 2,
      meals: [
        '1食だけ、卵2個・サラダチキン・鮭・豆腐のどれかを主役にする',
        '主食は抜かずに半〜1杯で合わせる',
        '副菜はサラダか味噌汁で十分'
      ],
      aim: '何を食べないかより、1食だけ軸を作ると流れが安定しやすいです。'
    },
    {
      id: 'stress_relief',
      title: '食べすぎ反動を抑える安心プラン',
      when: '食べすぎの後やストレスが強い日',
      tags: ['反動防止', '安心', '切り替え'],
      match: (c) => c.stressEatingScore >= 1,
      meals: [
        '次の食事を抜かず、汁物 + たんぱく質 + 主食少なめにする',
        '甘いものをゼロにするより量を半分にする',
        '夜は温かいものを優先する'
      ],
      aim: '帳尻合わせを急ぐより、反動が広がらない組み方を優先します。'
    },
    {
      id: 'seasonal_summer',
      title: '夏のだれ対策プレート',
      when: '暑さで食欲が落ちやすい時期',
      tags: ['夏', '食欲低下', 'さっぱり'],
      match: (c) => c.season === 'summer',
      meals: [
        '主菜: 冷しゃぶ or 豆腐 or サラダチキン',
        '主食: おにぎり1個 or そうめん少なめ',
        '副菜: トマト・きゅうりなど食べやすい野菜'
      ],
      aim: '食欲が落ちても、たんぱく質と炭水化物を少しずつ入れやすい形です。'
    },
    {
      id: 'seasonal_winter',
      title: '冬の温め定食',
      when: '冷えやすい時期',
      tags: ['冬', '温める', '落ち着く'],
      match: (c) => c.season === 'winter',
      meals: [
        '主菜: 鍋・スープ・味噌汁ベース',
        '主食: ごはん 1杯',
        '副菜: 豆腐・卵・きのこを足す'
      ],
      aim: '冷えや疲れが重なりやすい時期は、温かいものから整える方が続きやすいです。'
    }
  ];
}

function prioritizeTemplates(condition, templates) {
  const scored = templates.map((template) => {
    let score = template.match(condition) ? 10 : 0;
    if (template.id === 'protein_anchor' && condition.constitutionType) score += 1;
    if (template.id === 'stress_relief' && /寄り添い|安心/.test(condition.aiType)) score += 1;
    if (template.id === 'protein_anchor' && /理論|理屈|ロジック/.test(condition.aiType)) score += 1;
    if (condition.lowWaterScore >= 1 && /水|汁物/.test(template.meals.join(' '))) score += 1;
    return { template, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.template);
}

function buildSuggestionTone(condition) {
  if (/理論|理屈|ロジック/.test(condition.aiType)) return 'logic_first';
  if (/寄り添い|安心|やさし/.test(condition.aiType)) return 'care_first';
  return 'balanced';
}

function buildMealPlanSuggestions(params = {}) {
  const condition = inferConditionProfile(params);
  const ranked = prioritizeTemplates(condition, getPlanTemplates());
  const selected = ranked.slice(0, 2);

  if (!selected.length) {
    selected.push(getPlanTemplates().find((item) => item.id === 'protein_anchor'));
  }

  return {
    condition,
    tone: buildSuggestionTone(condition),
    plans: selected.filter(Boolean).map((template) => ({
      id: template.id,
      title: template.title,
      when: template.when,
      tags: template.tags,
      meals: template.meals,
      aim: template.aim
    }))
  };
}

function buildMealPlanReply(params = {}) {
  const result = buildMealPlanSuggestions(params);
  const lines = [];

  if (result.tone === 'care_first') {
    lines.push('今の流れなら、きっちり正すより楽に戻しやすい形を優先したいです。');
  } else if (result.tone === 'logic_first') {
    lines.push('今の状態だと、負担を増やさず再現しやすい食事の型に寄せるのが効率的です。');
  } else {
    lines.push('今の流れに合わせて、無理なく続けやすい候補を2つに絞ります。');
  }

  result.plans.forEach((plan, index) => {
    lines.push(`\n【候補${index + 1}】${plan.title}`);
    lines.push(plan.aim);
    plan.meals.forEach((meal) => lines.push(`・${meal}`));
  });

  if (result.condition.lowWaterScore >= 1) {
    lines.push('\n水分が少なめの流れも見えるので、食事と一緒に一杯つけるだけでもかなり違います。');
  }

  return lines.join('\n');
}

module.exports = {
  getSeasonInJapan,
  inferConditionProfile,
  buildMealPlanSuggestions,
  buildMealPlanReply
};
