'use strict';

const { parseProfile } = require('../parsers/profile_parser');
const { getImageContext, isProfileMode } = require('./context_memory_service');

function normalize(text = '') {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[　\s]+/g, '')
    .replace(/[!！?？。、,.]/g, '');
}

function hasAny(text = '', patterns = []) {
  return patterns.some((pattern) => normalize(text).includes(normalize(pattern)));
}

function isQuestionLike(text = '') {
  return /[?？]|ですか|ますか|かな|どう|何|なに|教えて|覚えて/.test(String(text || ''));
}

function classifyInput({ text = '', user = {}, userKey = '' } = {}) {
  const raw = String(text || '').trim();
  const profilePatch = parseProfile(raw);

  if (!raw) return { intent: 'empty' };

  if (hasAny(raw, ['初期設定', 'プロフィール変更', 'プロフィール登録', 'プロフィール入力'])) {
    return { intent: 'profile_start' };
  }

  if (isProfileMode(userKey) && Object.keys(profilePatch).length) {
    return { intent: 'profile_update', profilePatch };
  }

  if (Object.keys(profilePatch).length && hasAny(raw, ['性別', '年齢', '身長', '目標', '活動量'])) {
    return { intent: 'profile_update', profilePatch };
  }

  if (hasAny(raw, ['今日のまとめ', '今日の食事まとめ', '総まとめ', '今日の振り返り'])) return { intent: 'daily_summary' };
  if (hasAny(raw, ['今何時', '何時'])) return { intent: 'time' };
  if (hasAny(raw, ['今日は何月何日', '今日何月何日', '今日の日付', '何月何日'])) return { intent: 'date' };
  if (hasAny(raw, ['あなたの名前', 'ai牛込', '君の名前'])) return { intent: 'assistant_name' };
  if (hasAny(raw, ['私の名前', '名前覚えて', 'なんて呼べば', '呼び名'])) return { intent: 'user_name' };
  if (hasAny(raw, ['何を覚えている', '何覚えてる', '前に何て言った', '覚えてる？'])) return { intent: 'memory_recall' };
  if (hasAny(raw, ['体重グラフ', '食事活動グラフ', 'hba1cグラフ', 'ldlグラフ', 'グラフ'])) return { intent: 'graph' };
  if (hasAny(raw, ['予測', '体重予測'])) return { intent: 'prediction' };
  if (hasAny(raw, ['私の体重', '今の体重', '体重覚えて'])) return { intent: 'latest_weight' };

  if ((/体脂肪/.test(raw) || /%/.test(raw)) && !/食/.test(raw) && !isQuestionLike(raw)) return { intent: 'body_metrics' };
  if ((/kg|キロ|体重/i.test(raw) || /^\d{2,3}(?:\.\d+)?$/.test(raw)) && !isQuestionLike(raw)) return { intent: 'body_metrics' };

  if (hasAny(raw, ['ジョギング', 'ランニング', '歩いた', '散歩', 'ウォーキング', '筋トレ', 'ストレッチ', 'スクワット', '腕立て', '腹筋', '運動']) && !isQuestionLike(raw)) return { intent: 'activity_record' };

  const imageContext = getImageContext(userKey);
  if (imageContext === 'meal' && !hasAny(raw, ['血液検査'])) return { intent: 'meal_followup' };
  if (imageContext === 'lab' && !hasAny(raw, ['食事'])) return { intent: 'lab_followup' };

  if (hasAny(raw, ['血液検査', 'hba1c', 'ldl', 'hdl', '中性脂肪', '血糖'])) return { intent: 'lab_query' };
  if (hasAny(raw, ['朝ごはん', '朝食', '昼ごはん', '昼食', '夜ごはん', '夕食', '食べた', '飲んだ', 'おやつ']) && !isQuestionLike(raw)) return { intent: 'meal_record' };
  if (hasAny(raw, ['食事の写真です'])) return { intent: 'meal_followup' };
  if (hasAny(raw, ['血液検査です'])) return { intent: 'lab_followup' };
  if (hasAny(raw, ['相談したい'])) return { intent: 'consultation' };

  if (hasAny(raw, ['痛い', 'しびれ', '不安', '苦しい', 'つらい', '相談', 'どうしたら', 'どうすれば']) || isQuestionLike(raw)) return { intent: 'consultation' };

  return { intent: 'conversation' };
}

module.exports = {
  classifyInput,
};
