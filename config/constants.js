const MEAL_ACTIONS = {
  SINGLE: 'この1枚で食事解析',
  ADD_IMAGE: '食事写真を追加',
  ADD_TEXT: '文章で食事追加',
  CANCEL: '食事をやめる',
  DUPLICATE_ANGLE: '同じ食事の別角度',
  SAME_PHOTO: '同じ写真を送った',
  EXTRA: '追加料理あり',
  SAVE: 'この内容で食事保存',
};

const ACTIVITY_ACTIONS = {
  SAVE: 'この内容で運動保存',
  ADD: '運動を追加',
  CANCEL: '運動をやめる',
};

const INTAKE_STEPS = [
  'choose_ai_type',
  'choose_main_goal',
  'choose_main_concern',
  'choose_activity_level',
  'choose_sleep_level',
  'choose_support_style',
  'ideal_future_free',
  'confirm_finish',
];

const AI_TYPE_MAP = {
  'やさしい伴走': 'gentle',
  '元気応援': 'energetic',
  '分析サポート': 'analytical',
  '気軽トーク': 'casual',
};

const AI_TYPE_LABEL = {
  gentle: 'やさしい伴走',
  energetic: '元気応援',
  analytical: '分析サポート',
  casual: '気軽トーク',
};

const INTAKE_OPTIONS = {
  choose_ai_type: ['やさしい伴走', '元気応援', '分析サポート', '気軽トーク'],
  choose_main_goal: ['健康改善', '体重管理', '美容も整えたい', '生活習慣改善'],
  choose_main_concern: ['食事', '睡眠', 'むくみ', '姿勢', '血液検査'],
  choose_activity_level: ['ほぼ運動なし', 'たまに動く', '週1〜2回', '週3回以上'],
  choose_sleep_level: ['5時間未満', '5〜6時間', '6〜7時間', '7時間以上'],
  choose_support_style: ['優しく伴走', 'しっかり励ます', '理由も知りたい', '気軽に話したい'],
};

const MEAL_WORD_HINTS = [
  '朝食', '昼食', '夕食', '夜食', '間食', '朝ごはん', '昼ごはん', '晩ごはん',
  'パン', 'ご飯', '米', 'おにぎり', 'うどん', 'そば', 'パスタ', 'ラーメン',
  'サラダ', '卵', '納豆', '豆腐', '味噌汁', 'みそ汁', '焼き魚', '魚', '肉',
  '鶏', '豚', '牛', 'ハンバーグ', 'カレー', 'シチュー', '餃子', '唐揚げ',
  'ケーキ', 'チョコ', 'クッキー', 'アイス', 'ヨーグルト', 'バナナ', 'りんご',
  'コーヒー', '紅茶', 'ラテ', 'ジュース', '牛乳', 'チーズ', '食パン', 'トースト',
  '大福', 'まんじゅう', '饅頭', 'どら焼き', 'たい焼き', 'おはぎ', '羊羹', 'ようかん',
  '最中', 'もなか', '団子', 'だんご', 'せんべい', '煎餅', 'あんみつ', 'ぜんざい',
  '和菓子', 'あんこ', 'もち', '餅', '柏餅', '桜餅', 'みたらし団子',
  'ガパオ', 'パッタイ', 'お好み焼き', '広島焼き', '機内食', '弁当', '定食',
  'スタバ', 'モンスーン', 'コンビニ',
];

const EXERCISE_WORD_HINTS = [
  '歩いた', '歩きました', '歩く', '散歩', 'ウォーキング', '歩行',
  'ジョギング', 'ランニング', 'スロージョギング', '走った', '走りました',
  '階段', '自転車', 'バイク', '筋トレ', '運動', 'ストレッチ',
  'スクワット', '腹筋', '腕立て', '膝つき腕立て', 'プランク',
  'ラジオ体操', '体操', 'ヨガ', '体幹', 'もも上げ', '開脚', '伸ばした',
];

module.exports = {
  MEAL_ACTIONS,
  ACTIVITY_ACTIONS,
  INTAKE_STEPS,
  AI_TYPE_MAP,
  AI_TYPE_LABEL,
  INTAKE_OPTIONS,
  MEAL_WORD_HINTS,
  EXERCISE_WORD_HINTS,
};