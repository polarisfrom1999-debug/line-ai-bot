'use strict';

const aiChatService = require('./ai_chat_service');
const replyContextBuilder = require('./reply_context_builder_service');
const mealTextManualRecordService = require('./meal_text_manual_record_service');
const ushigomeConversationStyleService = require('./ushigome_conversation_style_service');
const movementGoalCompanionService = require('./movement_goal_companion_service');
const movementSelfcareLibrary = require('./movement_selfcare_library_service');
const movementSupportClassifier = require('./movement_support_classifier_service');
const movementLifeSceneSelfcare = require('./movement_life_scene_selfcare_service');
const movementReactionFollowup = require('./movement_reaction_followup_service');

const SAFE_MOVEMENT_FOLLOWUP = '終わったら「楽・変わらない・痛い・しびれ」で教えてください。';

function ensureMovementFollowup(body) {
  const b = normalizeText(body);
  if (!b) return SAFE_MOVEMENT_FOLLOWUP;
  if (/楽・変わらない|「楽」「変わらない」|しびれ」で教え|楽・変わらない・痛い・しびれ/.test(b)) return b;
  return `${b}\n\n${SAFE_MOVEMENT_FOLLOWUP}`;
}

function buildReactionFollowupFallback(kind) {
  const k = String(kind || '');
  if (k === movementReactionFollowup.REACTION_KIND.BETTER) {
    return [
      '良い反応です。',
      '今日は増やさず、同じ強さで十分です。',
      '明日も同じくらいで、楽になる感じが再現できるか見ましょう。',
    ].join('\n');
  }
  if (k === movementReactionFollowup.REACTION_KIND.SAME) {
    return [
      '変わらなかったんですね。こちらから無理に増やす必要はありません。',
      '次は別のやさしい動きに切り替えるのもありです。いま一番近いのは、腰・脚・首肩のどれですか？',
    ].join('\n');
  }
  if (k === movementReactionFollowup.REACTION_KIND.WORSE) {
    return [
      '痛みが出たんですね。そこで止めてください。',
      '強さか動きの方向が合わなかった可能性があります。必要なら医療機関・専門への相談を優先しましょう。',
      '今日はこの動きは中止で大丈夫です。',
    ].join('\n');
  }
  if (k === movementReactionFollowup.REACTION_KIND.NUMB) {
    return [
      'しびれが出たんですね。セルフケアはいったん止めてください。',
      '神経に響いている可能性があるので、確認を優先しましょう。',
    ].join('\n');
  }
  if (k === movementReactionFollowup.REACTION_KIND.SCARED) {
    return [
      '怖くなったんですね。無理に続けなくて大丈夫です。',
      '今日は休む選択で大丈夫です。また落ち着いたら、やさしい版からで構いません。',
    ].join('\n');
  }
  if (k === movementReactionFollowup.REACTION_KIND.MORE) {
    return [
      'もう少しできそうな感じなんですね。',
      'でも今日は回数を増やさず、同じ強さで十分です。続けられる形を優先しましょう。',
    ].join('\n');
  }
  if (k === movementReactionFollowup.REACTION_KIND.DONE_ACK) {
    return [
      'できたんですね。今日はそれで十分です。',
      '次回も同じ量からで大丈夫です。',
    ].join('\n');
  }
  return [
    'どの感じに近かったか、「楽・変わらない・痛い・しびれ」で短く教えてもらえますか？',
  ].join('\n');
}

function buildLifeSceneOpening(ut) {
  if (/朝起き|起きると腰|朝.*腰.*固|朝.*腰が固/.test(ut)) return '朝起きた時に腰が固いんですね。';
  if (/朝.*股関節|股関節.*朝/.test(ut) && /固|こわば/.test(ut)) return '朝、股関節が固い感じですね。';
  if (/ゴキブリ|ごきぶり/.test(ut) || (/朝.*体が重い|体が重い.*朝/.test(ut))) return '朝、体が重い感じですね。';
  if (/布団|寝ながら/.test(ut) && /自転車|こぎ/.test(ut)) return '布団の中で少し動かしていいか、迷っているんですね。';
  if (/お風呂|おふろ|風呂|湯船/.test(ut) && /腰.*伸ば|伸ばして/.test(ut)) return 'お風呂で腰を伸ばしていいか、迷っているんですね。';
  if (/椅子で/.test(ut) && /腰.*体操|体操.*腰/.test(ut)) return '椅子で腰を整えたいんですね。';
  return '';
}

function normalizeText(v) {
  return String(v || '').trim();
}

function buildMovementOpening(userText, mg) {
  const ut = normalizeText(userText);
  if (/腰が重|腰.*張|腰がつら/.test(ut)) return '腰が重いんですね。';
  if (/脊柱管|狭窄/.test(ut)) return '脊柱管狭窄症と言われているんですね。';
  if (/ぎっくり|動くのが怖/.test(ut)) return 'ぎっくり腰っぽくて動くのが怖いんですね。';
  if (/肩が上がり|五十肩/.test(ut)) return '肩を上げる時に引っかかる感じですね。';
  if (/膝.*筋トレ|家で.*筋トレ/.test(ut)) return '膝に不安がある中でも、家でできることを探しているんですね。';
  if (/ストレートネック|首肩/.test(ut)) return '首肩がつらいんですね。';
  if (/排尿|排便/.test(ut) && /腰痛|しびれ/.test(ut)) return '腰痛と足のしびれ、排尿の変化があるんですね。';
  if (/シンスプリント|すね/.test(ut) && /練習していい|練習しても|走っていい|走ってもいい/.test(ut)) {
    return 'シンスプリントの時期に、練習の判断を迷っているんですね。';
  }
  if (/走るとすね|走ると.*すね|すね.*内側/.test(ut)) return '走るとすねの内側が痛いんですね。';
  if (/シンスプリント/.test(ut)) return 'シンスプリントで気になるんですね。';
  if (/ろれつ|話がうまく|言葉が出/.test(ut)) return 'ろれつが回りにくい感じがあるんですね。';
  if (/片側.*麻痺|片麻痺|麻痺.*片側/.test(ut)) return '片側の麻痺があるんですね。';
  if (/胸が苦|息が苦/.test(ut)) return '胸が苦しいんですね。';
  if (/転んで|腫れ/.test(ut)) return '転んで手首が腫れているんですね。';
  if (/排尿|排便/.test(ut) && /腰|しびれ/.test(ut)) return '腰痛と足のしびれ、排尿の変化があるんですね。';
  if (mg?.goal_context && /目標|続け|練習/.test(ut)) return '目標に向けて続けたい気持ち、受け取りました。';
  return 'いまの状態、受け取りました。';
}

function isShinSplintRunPainSafeCase(userText = '', mg = {}) {
  const ut = normalizeText(userText);
  if (mg?.block_self_care) return false;
  if (!/走ると.*すね|走るとすね|すね.*内側|シンスプリント/.test(ut)) return false;
  if (/練習していい|練習しても|走っていい|走ってもいい/.test(ut)) return false;
  if (/一点|ズキッ|片脚.*ジャンプ|歩いても痛|休んでも痛/.test(ut)) return false;
  return true;
}

function buildShinSplintSafeRunPainReply(open = '') {
  const lead = open || '走るとすねの内側が痛いんですね。';
  return [
    lead,
    'シンスプリントっぽい時は、まず走る量を増やさず、すねとふくらはぎの負担を落とす方が先です。',
    '',
    '今日は足首回しを左右10回。',
    'ふくらはぎを軽く10秒だけ伸ばしてみましょう。痛みが強くなったら中止で。',
    '',
    '一点がズキッと痛い、歩いても痛い、片脚ジャンプで痛い、休んでも痛い時は、無理に練習せず確認が必要です。',
    SAFE_MOVEMENT_FOLLOWUP,
  ].join('\n');
}

function buildManualNutritionBlock(featureResults = {}) {
  const lines = [];
  const breakdown = Array.isArray(featureResults.breakdownLines)
    ? featureResults.breakdownLines.filter(Boolean)
    : [];
  if (breakdown.length) {
    lines.push(`手入力の目安：${breakdown.join(' / ')}`);
  } else if (Number.isFinite(Number(featureResults.kcal)) && Number(featureResults.kcal) > 0) {
    lines.push(`手入力の目安：約${Math.round(Number(featureResults.kcal))}kcal`);
  }
  const daily = Number(featureResults.dailyTotalKcal);
  if (Number.isFinite(daily) && daily >= 0) {
    lines.push(`今日の合計：約${Math.round(daily)}kcal`);
  }
  return lines.join('\n');
}

function buildLabValuesBlock(featureResults = {}) {
  const lines = Array.isArray(featureResults.formattedLines)
    ? featureResults.formattedLines.map((x) => normalizeText(x)).filter(Boolean)
    : [];
  if (!lines.length) return '';
  if (featureResults.needsReadConfirmation) {
    lines.push('読み取り確認が必要な扱いです');
  }
  return lines.join('\n');
}

function modeSystemInstructions(conversationMode, replyDepth) {
  const cm = normalizeText(conversationMode);
  if (cm === 'emotional_support') {
    return [
      '会話モード: emotional_support（感情の受け止め）',
      '返信は2〜4文。短く自然に。',
      '食事・運動・検査・カロリーには触れない。',
      '定型の安心文・伴走テンプレ・励ましの型を使わない。',
      '必要なら、感情の種類を1つだけ優しく聞く。',
    ].join('\n');
  }
  if (cm === 'correction_feedback' || cm === 'assistant_error_feedback') {
    return [
      '会話モード: correction_feedback（訂正・ズレの謝罪）',
      '謝って、どこを直したいか聞く。2〜3文。',
      '伴走文・整理の提案・抱えすぎ系は禁止。',
    ].join('\n');
  }
  if (cm === 'meal_text_record' || cm === 'meal_record_text') {
    return [
      '会話モード: meal_text_record（手入力食事の記録後）',
      '前半は自然な会話文のみ。ユーザーが書いた品目に直接反応する。',
      '数値行は書かない（システムが後から付ける）。',
      '根拠が2回未満のとき「安定してきています」とは言わない。代わりに整えやすい・軽い朝など。',
      '記録しました・いい流れです等の定型は禁止。',
    ].join('\n');
  }
  if (cm === 'reward_food' || cm === 'meal_note') {
    return [
      '会話モード: reward_food（ご褒美食）',
      '責めない。ご褒美テンプレの繰り返しはしない。',
      '数値行は書かない。',
      '2〜3文で自然に。',
    ].join('\n');
  }
  if (cm === 'exercise_feedback') {
    return [
      '会話モード: exercise_feedback（運動・身体感覚への反応）',
      'ユーザーが感じた身体の変化に直接反応する。2〜3文。',
      'ストレッチ・腕・伸び・感じなどの語を自然に使う。',
      '記録しました・いい流れです・無理に量を増やさ等の定型は禁止。',
      'カロリー計算の表示は書かない。',
    ].join('\n');
  }
  if (cm === 'life_companion') {
    return [
      '会話モード: life_companion（生活・相談の自然な会話）',
      '2〜4文。まずユーザーの話に乗る。',
      '食事記録・検査値・カロリー表示には触れない（別機能）。',
      '伴走テンプレ・毎回同じ締めは禁止。',
    ].join('\n');
  }
  if (cm === 'lab_followup') {
    return [
      '会話モード: lab_followup（検査フォロー）',
      '検査値の数字行は書かない（システムが後から付ける）。',
      '1〜3文で、聞かれた項目への自然な前置きだけ。',
      '患者名・医療機関・印刷日の長い説明はしない。',
      '診断・治療判断はしない。主治医優先を短く添えてよい。',
    ].join('\n');
  }
  if (cm === 'lab_date_inventory') {
    return [
      '会話モード: lab_date_inventory（保存検査日の一覧）',
      '日付リストは書かない（システムが後から付ける）。',
      '1〜2文で前置きだけ。患者名・医療機関・印刷日は出さない。',
      '「TGの傾向は？」のように項目ごとに見られる旨を短く添えてよい。',
    ].join('\n');
  }
  if (cm === 'lab_comparison') {
    return [
      '会話モード: lab_comparison（検査の前後比較）',
      '数値行は書かない（システムが後から付ける）。',
      '1〜2文で、比較の前置きだけ。診断・治療判断はしない。',
      '患者名・医療機関・印刷日の長い説明はしない。',
    ].join('\n');
  }
  if (cm === 'exercise_record') {
    return [
      '会話モード: exercise_record（運動の記録後）',
      '記録の事実に触れつつ、小さな継続を具体的に拾う。2〜3文。',
      '痛みがある文脈では回数を増やさない。カロリー行は書かない。',
    ].join('\n');
  }
  if (cm === 'body_condition_note') {
    return [
      '会話モード: body_condition_note（体調・痛み・睡眠）',
      '成果より安全。減量称賛より体調優先。2〜4文。',
      '医療診断はしない。強い症状は受診を短く示す。',
    ].join('\n');
  }
  if (cm === 'movement_goal_companion') {
    return [
      '会話モード: movement_goal_companion（可動域・生活場面のセルフケア・反応フォロー）',
      '診断・治療断定はしない。赤旗・強い痛みは医療相談を先に。',
      '専門用語は使わず生活の言葉で書く。「ゴキブリ体操」の言い換え説明は書かない（手足ぶらぶら体操とだけ伝える）。',
      '安全なら生活場面に合う動きを1つだけ。回数・強さ（痛み0〜10の0〜3）・中止条件を必ず入れる。',
      'セルフケア提案の末尾に「楽・変わらない・痛い・しびれ」の反応確認を入れる（定型文の羅列ではなく自然文で）。',
      '痛みがある時は回数・強度を増やさない。数値・カロリー行は書かない。',
    ].join('\n');
  }
  return [
    `会話モード: ${cm || 'normal'}`,
    `reply_depth: ${replyDepth || 'normal'}`,
    'ChatGPTのLINE会話のように自然に。定型伴走文は禁止。',
  ].join('\n');
}

function buildConversationCorePromptBlock(ctx = {}) {
  const understanding = ctx.conversationUnderstanding || null;
  const strategy = ctx.replyStrategy || null;
  if (!understanding && !strategy) return '';
  const summary = {
    conversation_purpose: understanding?.conversation_purpose,
    emotional_state: understanding?.emotional_state,
    user_need: understanding?.user_need,
    reply_depth: strategy?.reply_depth || understanding?.reply_depth,
    feature_plan: understanding?.feature_plan,
    data_extraction_targets: understanding?.data_extraction_targets,
    praise_target: strategy?.praise?.target || understanding?.praise_target,
    praise_hint: strategy?.praise?.text_hint || null,
    anticipatory_support: strategy?.anticipatory_support || [],
    max_questions: strategy?.max_questions ?? understanding?.max_questions,
    safety_level: understanding?.safety_level,
    avoid: strategy?.avoid || [],
  };
  return [
    '[Conversation Core]',
    JSON.stringify(summary),
    '返信の主役は会話。食事・検査・運動・薬・陸上などの feature result は材料として使う。',
    'reply_depth=explain の時は、安心→結論→理由2〜3個→注意点→具体的な量・選び方・行動→最後に進める一言、の順に読みやすく書く。',
    '褒める時は、結果だけでなく質問・気づき・調整・安全な報告を具体的に拾う。',
    '先回りは最大2個。本人の性格ラベルは出さない。',
  ].join('\n');
}

function conversationCoreFallback(ctx = {}) {
  const ut = normalizeText(ctx.userText);
  const core = ctx.conversationUnderstanding || {};
  const strategy = ctx.replyStrategy || {};
  const purpose = normalizeText(core.conversation_purpose);

  if (core.safety_level === 'urgent' || purpose === 'crisis_or_urgent') {
    return [
      '今、それくらいつらいところまで来ているんですね。ここに言葉にしてくれたことは、とても大事です。',
      '',
      '今は一人で抱えないでください。身近な人に「今かなり危ない」とそのまま伝えて、ひとりにならない場所へ移動してください。',
      'もし今すぐ自分を傷つけそう、または安全を保てない感じがあるなら、119や地域の救急相談、身近な医療機関につないでください。',
      '',
      'ここでは診断はしません。まず今夜を安全に越えることを最優先にしましょう。',
    ].join('\n');
  }

  if (purpose === 'lab_question') {
    return [
      '血液検査結果が心配なんですね。心配な段階で聞いてくれて良かったです。',
      '',
      '結論、ここでは診断は断定せず、保存されているデータや画像があれば項目ごとに整理して見ます。',
      '',
      '見る時は、単回の良し悪しだけでなく、前回との差、検査日、気になる項目を分けると落ち着いて確認できます。',
      '医師に確認する前提で、まずは「尿酸」「LDL」「中性脂肪」のように項目名を送ってください。',
    ].join('\n');
  }

  if (purpose === 'medication_question') {
    if (/やめ|中止/.test(ut)) {
      return [
        '迷っている段階で確認してくれて良かったです。',
        '',
        '結論から言うと、薬は自己判断で中止や変更はしないでください。処方した医師・薬剤師に確認してからが安全です。',
        '',
        '理由は3つあります。',
        '1つ目は、急にやめると症状や数値が戻る薬があること。',
        '2つ目は、薬によっては中止の順番や量の調整が必要なこと。',
        '3つ目は、今の不安が副作用なのか、別の原因なのかを分けて見る必要があることです。',
        '',
        '相談するときは、薬名・飲んでいる量・いつから飲んでいるか・何が不安かをメモして持っていけば十分です。',
      ].join('\n');
    }
    return [
      '続けるか迷っているんですね。確認してから進めようとしているのは良い判断です。',
      '',
      'シナールのような薬でも、今の目的や体調によって判断が変わるので、処方元に確認する形が安全です。',
      '不安があるなら、いつから飲んでいるか、何が気になるかを短くまとめて相談しましょう。',
    ].join('\n');
  }

  if (/きなこ.*すりごま|すりごま.*きなこ/.test(ut)) {
    return [
      '変えて大丈夫です。買い出し前に確認できたのは、かなり良い進め方です。',
      '',
      '結論としては、きなこの代わりに白すりごまを少量使う形なら合わせやすいです。',
      '',
      '理由は、香ばしさが足せること、脂質が少し入って満足感が出やすいこと、ヨーグルトやアボカドにも混ぜやすいことです。',
      '',
      '量はまず大さじ1/2くらいで十分です。',
      '買うなら粒ごまではなく「すりごま」を選んでください。白すりごまの方が味が強すぎず、朝の食事に合わせやすいです。',
      '',
      'その形なら、安心して買い出しに進めます。',
    ].join('\n');
  }

  if (/作り置き/.test(ut)) {
    return [
      '作る前に確認できているのが良いです。あとから迷いにくくなります。',
      '',
      '結論、味を濃くしすぎず、あとで足せる形なら作り置きとして進めて大丈夫です。',
      '',
      '理由は、日によって食欲や活動量が変わること、家族分と自分の分で必要量が違うこと、濃い味だと翌日以降に調整しにくいことです。',
      '',
      '先に1食分を取り分けて、たんぱく質のおかずと野菜系を分けて保存すると使いやすいです。',
      '迷ったら、主食は後から足す形にしておくと安心です。',
    ].join('\n');
  }

  if (/コンビニ/.test(ut)) {
    return [
      'コンビニで先に決めておこうとしているの、良いです。',
      '',
      '選ぶなら、主食・たんぱく質・汁物か水分の3つで考えると迷いにくいです。',
      '',
      '例としては、おにぎり1個、ゆで卵かサラダチキン、味噌汁かお茶。',
      '甘い飲み物より先に水かお茶を選ぶと、全体が整いやすいです。',
      '',
      '今日は完璧に選ぶより、この3点だけそろえば十分です。',
    ].join('\n');
  }

  if (/旅行|たくさん歩/.test(ut)) {
    return [
      '旅行前に歩けるか不安なんですね。先に確認しておくのは良い準備です。',
      '',
      '結論、歩く量そのものより「休める場所」と「靴」と「翌日の余白」を作ると安心です。',
      '',
      '理由は、旅行中は普段より立ち時間が増えやすいこと、疲れてから休むと回復に時間がかかること、足腰の違和感は翌日に出ることがあるからです。',
      '',
      '当日は午前と午後で1回ずつ座る時間を先に入れてください。',
      '靴は履き慣れたものにして、痛みやしびれが出たら距離を増やさないで大丈夫です。',
      '',
      '準備しておけば、楽しむ方に気持ちを使えます。',
    ].join('\n');
  }

  if (/母|父|家族/.test(ut) && /膝|痛/.test(ut)) {
    return [
      'お母さんの膝のこと、心配になりますね。家族の様子を見て相談できているのは大事です。',
      '',
      'まずは、痛みの強さ・腫れ・熱感・歩けるかを分けて見てください。',
      '',
      '腫れている、熱を持っている、体重をかけられない、転倒後に痛い場合は、セルフケアより医療機関への確認が安心です。',
      '軽い違和感くらいなら、今日は無理に動かさず、階段や長歩きを減らすだけでも十分です。',
      '',
      '「いつから」「どこが」「歩くとどうか」を聞けると、次に整理しやすいです。',
    ].join('\n');
  }

  if (/100m.*タイム|タイム.*落/.test(ut)) {
    return [
      'タイムが落ちると、かなり気になりますよね。',
      '',
      '結論、1回のタイムだけで実力低下と決めなくて大丈夫です。まず疲労・睡眠・向かい風・アップの入り方を分けて見ましょう。',
      '',
      '特に100mは、脚の張りやスタート前の緊張、前日の疲れで数字が動きやすいです。',
      '次は「前半の出だし」「中盤の力み」「後半の落ち方」のどこで違ったかを見ると、次の練習につながります。',
    ].join('\n');
  }

  if (/200m.*5本|5本.*200m/.test(ut)) {
    return [
      '200mを5本走れたんですね。内容を残せているのが良いです。',
      '',
      '今日は本数を増やすより、各本のタイムの落ち方と、レスト後に動きが戻ったかを見るのが大事です。',
      'ハムやふくらはぎに張りが強いなら、追加で追い込まず、明日は軽めにして再現性を見ましょう。',
    ].join('\n');
  }

  if (/ハム/.test(ut) && /張/.test(ut)) {
    return [
      'ハムが張っている感じですね。気づいて報告できているのは良いです。',
      '',
      '今日は強く伸ばしたり、本数を足したりしない方が安全です。',
      '軽く歩いて張りが下がるか、押した痛みや走り出しの違和感が強いかを見ましょう。',
      '',
      '強い痛み、力が入りにくい、走ると悪化する感じがあれば、練習は増やさず確認を優先してください。',
    ].join('\n');
  }

  if (purpose === 'test_the_ai') {
    return [
      'そう感じるのは自然です。AIなので、わかったふりはしないようにします。',
      '',
      'ただ、送ってくれた言葉から「今ほしいのは答えか、整理か、聞いてほしいだけか」はできるだけ読みます。',
      '違ったら「そうじゃない」と言ってください。そこも会話として直します。',
    ].join('\n');
  }

  if (purpose === 'boundary_sensitive') {
    return [
      'もちろん、健康と直接関係ない話でも大丈夫です。',
      'ここでは、食事や運動に無理に戻さず、まずその話として聞きます。',
      '聞いてほしいだけか、少し整理したいか、どちらでも合わせます。',
    ].join('\n');
  }

  if (purpose === 'celebration') {
    return [
      '目標達成、おめでとうございます。',
      strategy?.praise?.text_hint || 'ここまで続けた成果ですね。',
      '今日は次の課題を急がず、何がうまくいったかだけ1つ覚えておきましょう。明日以降に再現しやすくなります。',
    ].join('\n');
  }

  if (purpose === 'shame_or_guilt') {
    return [
      '今日は何もできなかった、と感じているんですね。',
      'でも、こうして言葉にできた時点で、途切れたのではなく調整の日として扱えます。',
      '今日は増やす日ではなく、睡眠・水分・早めに休む、のどれか1つで十分です。',
    ].join('\n');
  }

  if (/仕事で嫌|嫌なこと/.test(ut)) {
    return [
      'それは嫌でしたね。',
      '今は解決策より、まずその場面がしんどかったことをそのまま受け取ります。',
      '話せそうなら、何を言われた・されたのが一番残っているか、そこだけ教えてください。',
    ].join('\n');
  }

  if (/寂しい|さみしい/.test(ut)) {
    return [
      '寂しい感じがあるんですね。',
      'そういう日は、元気を出そうとするほど余計にしんどくなることがあります。',
      '今は短くでいいので、誰かに会いたい寂しさなのか、わかってほしい寂しさなのか、近い方だけ教えてください。',
    ].join('\n');
  }

  if (/疲れ/.test(ut)) {
    return [
      '今日は疲れたんですね。',
      '整えるより先に、疲れていることをそのまま扱って大丈夫です。',
      '今日は水分を取って、追加で頑張ることは1つ減らしましょう。',
    ].join('\n');
  }

  return '';
}

function enforceConversationCoreReply(ctx = {}, reply = '') {
  const ut = normalizeText(ctx.userText);
  const core = ctx.conversationUnderstanding || {};
  let text = normalizeText(reply);
  if (!text) return text;
  const fallback = conversationCoreFallback(ctx);

  if (core.safety_level === 'urgent' && !/(119|救急|ひとり|一人|身近|相談)/.test(text)) {
    return fallback;
  }
  if (/薬.*(やめ|中止)|やめてもいい/.test(ut) && !/(自己判断|処方|医師|薬剤師)/.test(text)) {
    return fallback;
  }
  if (core.conversation_purpose === 'medication_question' && !/(処方|医師|薬剤師|確認)/.test(text)) {
    return fallback;
  }
  if (core.conversation_purpose === 'lab_question' && !/(検査|データ|画像|項目|医師|診断|断定)/.test(text)) {
    return fallback;
  }
  if (/きなこ.*すりごま|すりごま.*きなこ/.test(ut)) {
    if (!/大さじ1\/2|大さじ半分|すりごま/.test(text) || !/粒ごま|白すりごま/.test(text)) {
      return fallback;
    }
  }
  if (/コンビニ/.test(ut) && !/(主食|たんぱく|水分|お茶)/.test(text)) {
    return fallback;
  }
  if (/血液検査|検査結果/.test(ut) && /(診断です|治療|必ず)/.test(text)) {
    return fallback;
  }
  if (fallback && /作り置き|旅行|母.*膝|膝.*母|100m.*タイム|200m.*5本|ハム.*張|目標達成|どうせAI|健康と関係ない|今日は疲れ|疲れました|仕事で嫌|寂しい|何もでき/.test(ut)) {
    if (core.reply_depth === 'explain' && text.length < 80) return fallback;
    if (/疲れました|今日は疲れ/.test(ut) && !/(疲れ|休|水分|減ら)/.test(text)) return fallback;
    if (/母.*膝|膝.*母/.test(ut) && !/(腫れ|歩け|医療|確認)/.test(text)) return fallback;
    if (/ハム.*張/.test(ut) && !/(増や|強い痛み|確認)/.test(text)) return fallback;
    if (/目標達成/.test(ut) && !/(目標|達成|成果|再現|おめでとう)/.test(text)) return fallback;
    if (/どうせAI/.test(ut) && !/(AI|わかったふり|違ったら|直)/.test(text)) return fallback;
    if (/健康と関係ない/.test(ut) && !/(健康|関係ない|話|聞|合わせ)/.test(text)) return fallback;
    if (/死にたい|消えたい/.test(ut)) return fallback;
  }
  return text;
}

function fallbackProse(ctx) {
  const ut = normalizeText(ctx.userText);
  const cm = normalizeText(ctx.conversationMode);
  const fr = ctx.featureResults || {};
  const stable = Number(ctx.userContext?.stableRoutineEvidenceCount || fr.stableRoutineEvidenceCount || 0);

  const coreFallback = conversationCoreFallback(ctx);
  if (coreFallback && !['meal_text_record', 'meal_record_text', 'reward_food', 'meal_note', 'lab_followup', 'lab_date_inventory', 'lab_comparison', 'movement_goal_companion', 'exercise_record', 'exercise_feedback', 'body_condition_note'].includes(cm)) {
    return coreFallback;
  }

  if (
    cm !== 'movement_goal_companion'
    && (cm === 'emotional_support' || /心が重|気持ちが重|つらい|しんど|寂し|不安/.test(ut))
  ) {
    return [
      '心が重いんですね。',
      '今日は無理に整えようとしなくて大丈夫です。',
      '',
      '今いちばん近いのは、疲れ・不安・寂しさ・悔しさのどれですか？',
    ].join('\n');
  }

  if (cm === 'correction_feedback' || cm === 'assistant_error_feedback' || /間違え|違う|ズレ|ずれて/.test(ut)) {
    return [
      'すみません、今の返しはズレていました。',
      '直前の内容を見直します。どこを直したいか、そのまま教えてください。',
    ].join('\n');
  }

  if (cm === 'reward_food' || cm === 'meal_note' || fr.recordKind === 'reward_food') {
    const items = (fr.items || []).join('、') || ut.replace(/食べちゃいました|食べました/g, '').trim();
    const countMatch = ut.match(/(\d+)\s*個/);
    const countHint = countMatch ? `${countMatch[1]}個` : '';
    const label = items || (ut.includes('おはぎ') ? `おはぎ${countHint || ''}` : 'それ');
    return [
      `${label}ですね。`,
      'これは責めなくて大丈夫です。次の食事を少し軽めに戻せれば十分です。',
    ].join('\n');
  }

  if ((cm === 'meal_text_record' || cm === 'meal_record_text' || fr.recordKind === 'meal_text_record') && fr.saved) {
    const echoSource = isShortAck(ut) && (fr.items || []).length ? (fr.items || []).join('、') : ut;
    const items = (fr.items || []).join('、') || echoSource;
    const breakfast = mealTextManualRecordService.isBreakfastRoutineContext(
      { items: fr.items },
      ut
    );
    const lines = [`${items}ですね。`];
    if (breakfast && stable >= 2) {
      lines.push('朝の形として、だいぶ落ち着いてきている感じですね。');
    } else if (breakfast || /白湯|卵/.test(ut)) {
      lines.push('軽く始めたい朝には、ちょうど整えやすい形です。');
    } else {
      lines.push('今日の流れの中で、無理のない形として受け止めています。');
    }
    return lines.join('\n');
  }

  if (cm === 'exercise_feedback') {
    if (/腕/.test(ut) && /伸び|伸びた/.test(ut)) {
      return [
        'ストレッチ後に腕の伸びを感じられたんですね。',
        'その感覚に気づけているのは、身体へのケアとしてとても良い流れです。',
        '次も同じペースで十分です。',
      ].join('\n');
    }
    if (/痛/.test(ut) && /楽/.test(ut)) {
      return [
        '痛みがあった中で、ストレッチ後に楽になった感覚まで届いていますね。',
        'その変化に気づけているのが良いです。無理に強度は上げず、同じペースで十分です。',
      ].join('\n');
    }
    return [
      'ストレッチ後に身体の変化を感じられたんですね。',
      'その感覚に気づけているのは、身体へのケアとしてとても良い流れです。',
      '次も同じペースで十分です。',
    ].join('\n');
  }

  const themes = ushigomeConversationStyleService.inferThemes(ut);

  if (cm === 'body_condition_note') {
    if (/頭痛/.test(ut) && /食欲/.test(ut)) {
      return '頭痛があって食欲も落ちているんですね。減量の成果より、いまは体調を守る日として扱いましょう。水分と少量の糖質、早めの休息が優先です。';
    }
    if (/食欲がない|食べられません|あまり食べられ/.test(ut)) {
      return '食欲が落ちているんですね。減量を頑張る日というより、体調を整える日として扱いましょう。少量の糖質と水分、休息を優先で大丈夫です。';
    }
    if (/便|出ていません|便秘/.test(ut)) {
      return '便のリズムが気になるんですね。体重の増え方ともつながって不安になりやすいので、まず水分と温かい汁物から整えましょう。';
    }
    if (/寝不足|眠れ/.test(ut)) {
      return '寝不足ですね。今日は運動の強度も食事の制限も強めず、睡眠を優先する日にしましょう。';
    }
    if (/体重.*増/.test(ut)) {
      return '体重が増えたと感じているんですね。責める必要はなく、塩分・水分・睡眠・便通などの候補も一緒に見ていきましょう。';
    }
    return 'いまの体調、受け取りました。無理に追い込まず、今日できる小さな一手だけにしましょう。';
  }

  if (cm === 'movement_goal_companion') {
    const mg = ctx.movementGoalHints || movementGoalCompanionService.buildMovementGoalHints({
      userText: ut,
      conversationMode: cm,
      userContext: ctx.userContext,
    });
    const sl = mg.safety_level || '';
    const open = buildMovementOpening(ut, mg);

    if (sl === movementSupportClassifier.SAFETY_LEVEL.RED_FLAG || mg.block_self_care) {
      return [
        open,
        mg.red_flag_message || 'いまの状態は、まず医療機関への相談を優先した方が安全です。強い痛みやしびれ、力の入りにくさがある場合は早めに確認してください。',
        'ここから。では病名の断定はせず、今日は無理に体を動かさないことだけ一緒に整理しましょう。',
      ].join('\n');
    }
    if (mg.reaction_followup && mg.reaction_followup.kind !== movementReactionFollowup.REACTION_KIND.UNKNOWN) {
      return buildReactionFollowupFallback(mg.reaction_followup.kind);
    }
    if (sl === movementSupportClassifier.SAFETY_LEVEL.NEEDS_MEDICAL_CHECK) {
      return [
        open,
        'いまの状態は、走る・ジャンプ・強い筋トレより先に専門家の確認が安心です。',
        '今日は痛みを増やさない休息と、負担を減らすことだけにしましょう。',
      ].join('\n');
    }
    if (sl === movementSupportClassifier.SAFETY_LEVEL.MOVEMENT_FEEDBACK) {
      return [
        open,
        'その変化に気づけているのが良いです。何が楽になったか、角度や呼吸を同じ感覚で再現できる程度で十分です。',
        '強度は上げず、同じペースで大丈夫です。',
      ].join('\n');
    }
    if (mg.life_scene_pick?.exercise) {
      const sceneOpen = buildLifeSceneOpening(ut) || open;
      return movementLifeSceneSelfcare.buildLifeSceneFallbackLines(mg.life_scene_pick, sceneOpen, ut).join('\n');
    }
    if (isShinSplintRunPainSafeCase(ut, mg)) {
      return buildShinSplintSafeRunPainReply(open);
    }
    if (mg.recommended_menu) {
      const menuBlock = movementSelfcareLibrary.formatMenuForReply(mg.recommended_menu);
      return ensureMovementFollowup([open, '今日は強く伸ばすより、次の一手だけで十分です。', menuBlock].join('\n'));
    }
    if (/シンスプリント|すね/.test(ut) && /練習していい|練習しても|走っていい|走ってもいい/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '迷ったら今日は走る量を増やさず、痛みが出たら休む・走らないを優先にしましょう。',
          '一点がズキッと痛い・片脚ジャンプが痛い・歩いても痛い・腫れがある時は、走る練習は控えて専門家に確認してください。',
          '痛みが広くて軽い日だけ、足首回し左右10回やふくらはぎの軽いケアで十分です。状態を送ってもらえれば一緒に整理します。',
        ].join('\n')
      );
    }
    if (/シンスプリント|すね.*内側|走るとすね|走ると.*すね/.test(ut)) {
      return buildShinSplintSafeRunPainReply(open);
    }
    if (/脊柱管|狭窄/.test(ut) && /しびれ|歩/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '歩くとしびれる・休むと楽になることも、一緒に見ていきましょう。今日は長く反らさず、椅子に座り、おしりの付け根あたりを前後に小さく10回だけ揺らしてみてください。',
          '痛みは0〜10のうち0〜3まで。痛みやしびれが増えたら中止で大丈夫です。',
        ].join('\n')
      );
    }
    if (/ぎっくり|動くのが怖/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '動くのが怖い気持ち、わかります。今日は強いストレッチより、楽な姿勢からで十分です。',
          '椅子に座り、おしりの付け根あたりを前後に10回だけ。痛みは0〜10のうち0〜3まで。痛みが増えたらそこで止めてください。',
        ].join('\n')
      );
    }
    if (/五十肩|肩が上がり|夜痛/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '無理に上まで上げるより、背中のあたりをゆるく動かす方から始めましょう。肘を軽く曲げて肩をすくめてストンと落とす。10回だけ。',
          '痛みは0〜10のうち0〜3まで。ズキッとする角度は避けてください。夜に痛みが強い日は回数を減らして大丈夫です。',
        ].join('\n')
      );
    }
    if (/ストレートネック|首肩/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '今日は無理に首を反らさず、胸を軽く開いてからで十分です。',
          '首をゆっくり左右に振る。各5〜8回だけ。痛みは0〜10のうち0〜3まで。',
          'しびれ・痛みが増えたら中止です。',
        ].join('\n')
      );
    }
    if (/腰が固|腰.*固|ストレッチ.*教/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '今日は強く伸ばすより、腰まわりを少しゆるめるくらいが良さそうです。',
          '仰向けで膝を立て、両膝をゆっくり左右に倒してみてください。まず10回だけ。',
          '痛みは0〜10のうち0〜3まで。痛みが強くなる、足にしびれが出る時は中止です。',
        ].join('\n')
      );
    }
    if (/腰が重|腰.*張/.test(ut)) {
      return ensureMovementFollowup(
        [
          open,
          '今日は強く伸ばすより、腰まわりを少しゆるめるくらいが良さそうです。',
          '仰向けで膝を立て、両膝をゆっくり左右に倒してみてください。まず10回だけ。',
          '痛みは0〜10のうち0〜3まで。痛みが強くなる、足にしびれが出る時は中止です。',
        ].join('\n')
      );
    }
    return ensureMovementFollowup(
      [
        open,
        '今日は1つだけ、やさしい版で十分です。痛みは0〜10のうち0〜3まで。痛みが増えたら中止で大丈夫です。',
      ].join('\n')
    );
  }

  if (cm === 'exercise_record' || fr.recordKind === 'exercise_record') {
    const label = normalizeText(fr.exerciseLabel || ut) || '運動';
    if (/できなかった|動けなかった/.test(ut)) {
      return '今日は動けなかったんですね。休めたのも、身体の調整のうちです。明日は肩回しだけでも十分です。';
    }
    if (/痛/.test(ut) && /スクワット|運動/.test(ut)) {
      return '痛みがある中での報告ですね。まず痛みの様子を大事にし、回数よりフォームと中止の目安を意識しましょう。';
    }
    if (/草むしり/.test(ut)) {
      return '草むしり、届いています。立派な活動量ですね。腰や膝が気になる日は、あとから軽くストレッチする程度で十分です。';
    }
    if (/縄跳び|エアー/.test(ut)) {
      return '縄跳び、記録できていますね。小さく続けられているのが良い流れです。足や膝が気になる日は無理に時間を延ばさなくて大丈夫です。';
    }
    if (/スクワット/.test(ut)) {
      return 'スクワット、届いています。小さく続けられているのが良い流れです。無理に回数を増やさなくて大丈夫です。';
    }
    return `${label}、届いています。小さく続けられているのが良い流れです。無理に量を増やさなくて大丈夫です。`;
  }

  if (cm === 'life_companion') {
    if (themes.exerciseSkipped) {
      return '今日は動けなかったんですね。休めたのも、身体の調整のうちです。明日は肩回しだけでも十分です。';
    }
    if (themes.photoMissed) {
      return '写真は忘れても大丈夫です。あとから文字で送ってもらえれば、こちらで受け止めます。';
    }
    if (/抱っこ|子ども/.test(ut)) {
      return '抱っこしながら歩けたんですね。それも立派な活動量です。腰への負担が気になる日は、無理な追加運動はしなくて大丈夫です。';
    }
    if (/劇団|遅くな/.test(ut)) {
      return '劇団で遅くなったんですね。睡眠と疲れを優先して、明日はいつものリズムに戻せれば十分です。';
    }
    if (/お茶会/.test(ut)) {
      return 'お茶会、楽しめたんですね。楽しんだ日も大事です。次の食事で少し整えられれば十分です。';
    }
    if (/聞いて|相談|仕事|家族|人間関係/.test(ut)) {
      return [
        'それはしんどかったですね。',
        'いまの話、ちゃんと聞いています。',
        'もう少しだけ、どんな場面だったか教えてもらえますか？',
      ].join('\n');
    }
    return 'いまの話、受け取っています。生活の流れの中で、今日は無理のない形で整えていきましょう。';
  }

  if (cm === 'lab_followup') {
    const item = normalizeText(fr.itemName || '検査項目');
    if (fr.found && fr.queryType === 'single_item') {
      return `${item}のことですね。保存されているデータから、いま確認できる値をお伝えします。`;
    }
    if (fr.found && fr.queryType === 'trend') {
      return `${item}の推移ですね。直近で保存されている値を並べます。`;
    }
    if (fr.queryType === 'no_panel') {
      return 'この会話にはまだ検査データがつながっていないみたいです。検査の画像を送ってもらえると、項目ごとに見られます。';
    }
    return `${item || 'その項目'}は、いまのデータからはまだ特定しきれていません。もう一度項目名を送ってもらえると助かります。`;
  }

  if (cm === 'lab_date_inventory' || fr.queryType === 'lab_date_inventory') {
    return '保存されている検査日は、いまのところ以下が確認できます。必要なら「TGの傾向は？」のように項目ごとに見られます。';
  }

  if (cm === 'lab_comparison' || fr.queryType === 'comparison') {
    return '前回分と直近分を、保存されている範囲で並べます。医学的な解釈はせず、数値の並びだけお伝えします。';
  }

  if (!ut) return 'うん、届いています。続きがあればそのまま送ってください。';
  if (themes.rewardFood) {
    return '食べてしまった気持ち、受け取っています。責める必要はなく、次の食事で少し整えられれば十分です。';
  }
  if (themes.portionControl) {
    return '半分にできたんですね。我慢というより、調整力がついてきている感じです。';
  }
  return 'いまの話、受け取っています。今日は無理のない形で、小さな一手だけ一緒に見ていきましょう。';
}

function hasUnauthorizedStabilityInProse(prose, ctx) {
  if (Number(ctx.userContext?.stableRoutineEvidenceCount || ctx.featureResults?.stableRoutineEvidenceCount || 0) >= 2) {
    return false;
  }
  return /安定してきています|かなり安定して|朝の形として安定/.test(String(prose || ''));
}

function hasFoodEcho(userText, prose) {
  const ut = String(userText || '');
  const p = String(prose || '');
  if (/白湯/.test(ut) && /白湯/.test(p)) return true;
  if (/卵/.test(ut) && /卵/.test(p)) return true;
  if (/おはぎ/.test(ut) && /おはぎ/.test(p)) return true;
  if (/ご飯|ごはん/.test(ut) && /ご飯|ごはん/.test(p)) return true;
  const chunks = ut.split(/[,、，\s]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
  return chunks.some((c) => p.includes(c.slice(0, Math.min(8, c.length))));
}

function isShortAck(userText) {
  return /^(はい|うん|OK|ok|お[kK]|了解)$/i.test(normalizeText(userText));
}

function effectiveUserTextForEcho(ctx) {
  if (isShortAck(ctx.userText) && Array.isArray(ctx.featureResults?.items) && ctx.featureResults.items.length) {
    return ctx.featureResults.items.join('、');
  }
  return ctx.userText || '';
}

function isAcceptableProse(ctx, prose) {
  const text = normalizeText(prose);
  if (text.length < 6) return false;
  const cm = normalizeText(ctx.conversationMode);
  const ut = effectiveUserTextForEcho(ctx);
  const core = ctx.conversationUnderstanding || {};
  if (core.safety_level === 'urgent') {
    return /(ひとり|一人|身近|119|救急|相談|安全)/.test(text)
      && !/(カロリー|kcal|運動|ストレッチ)/i.test(text);
  }
  if (core.reply_depth === 'explain' && cm === 'life_companion') {
    return text.length >= 80
      && !/^なるほど。今の感じは受け取れた/.test(text)
      && !/(性格|心配性|神経質)/.test(text);
  }

  if (cm === 'emotional_support') {
    return /重|つら|しんど|気持ち|無理に|大丈夫|疲れ|不安|寂し|悔し/.test(text)
      && !/(kcal|カロリー|手入力の目安|TG|検査)/i.test(text);
  }
  if (cm === 'correction_feedback' || cm === 'assistant_error_feedback') {
    return /(すみません|ごめん|失礼|ズレ|ずれ|訂正|見直)/.test(text)
      && !/ひとりで抱えすぎ|一緒に整理していきましょう/.test(text);
  }
  if (cm === 'meal_text_record' || cm === 'meal_record_text' || cm === 'meal_text') {
    return hasFoodEcho(ut, text) && !hasUnauthorizedStabilityInProse(text, ctx);
  }
  if (cm === 'reward_food' || cm === 'meal_note') {
    if (/ラーメン/.test(ut) && !/ラーメン/.test(text)) return false;
    return !/(反省|禁物|だめだ|やりすぎ)/.test(text)
      && (hasFoodEcho(ut, text) || /責め|大丈夫|軽め/.test(text));
  }
  if (cm === 'exercise_feedback') {
    const rawUt = String(ctx.userText || '');
    const hasStrongBodyCue = /ストレッチ|腕|身体|伸び|肩|背中|可動|筋|動き/.test(text);
    const notGenericFallback = !/^なるほど。今の感じは受け取れた/.test(text);
    if (/ストレッチ|腕/.test(rawUt)) {
      const bodyCue = /(ストレッチ|腕|伸び|腰|楽|軽)/.test(text);
      return bodyCue && !/(記録しました|いい流れです|無理なく続け)/.test(text);
    }
    return hasStrongBodyCue && notGenericFallback;
  }
  if (cm === 'life_companion') {
    const ut = String(ctx.userText || '');
    if (/運動できなかった|動けなかった|できませんでした/.test(ut)) {
      if (/動けています|続けて体を動かせ|ちゃんと動け/.test(text)) return false;
      if (!/動けなかった|できませんでした|休め|調整|肩|休めた/.test(text)) return false;
    }
    return text.length >= 12
      && !/(手入力の目安|今日の合計|kcal|TG：|検査値)/i.test(text)
      && !/(記録しました|いい流れです)/.test(text)
      && !/^なるほど。今の感じは受け取れた/.test(text);
  }
  if (cm === 'body_condition_note') {
    const ut = String(ctx.userText || '');
    if (/^なるほど。今の感じは受け取れた/.test(text)) return false;
    if (/今日の流れの中で、無理のない形として受け止め/.test(text)) return false;
    if (/寝不足|眠れ/.test(ut) && !/眠|寝|睡眠|休息/.test(text)) return false;
    if (/便|出ていない|便秘/.test(ut) && !/便|水分|汁|野菜/.test(text)) return false;
    if (/食欲|食べられ/.test(ut) && !/食欲|体調|糖質|水分|休息|食べ/.test(text)) return false;
    if (/体重.*増/.test(ut) && !/(塩分|水分|睡眠|便|一喜一憂|むくみ|戻|失敗)/.test(text)) return false;
    if (/頭痛/.test(ut) && !/頭痛|体調|食欲|休息|水分/.test(text)) return false;
    return text.length >= 12;
  }
  if (cm === 'exercise_record') {
    const ut = String(ctx.userText || '');
    if (/スクワット|草むしり|縄跳び/.test(ut) && !/スクワット|草むしり|縄跳び|運動|続け|回/.test(text)) return false;
    return text.length >= 10 && !/^なるほど。今の感じは受け取れた/.test(text);
  }
  if (cm === 'lab_followup') {
    return text.length >= 8
      && !/^\s*(TG|HbA1c)[：:]\s*\d/i.test(text)
      && !/(記録しました|いい流れです|ここまでの流れ)/.test(text);
  }
  if (cm === 'lab_date_inventory') {
    return text.length >= 10
      && /(検査日|日付|保存|確認)/.test(text)
      && !/20\d{2}-\d{2}-\d{2}/.test(text)
      && !/(患者名|医療機関|印刷日)/.test(text);
  }
  if (cm === 'lab_comparison') {
    return text.length >= 10
      && /(比較|前回|直近|並べ)/.test(text)
      && !/^\s*(TG|HbA1c)[：:]\s*\d/i.test(text)
      && !/(患者名|医療機関|印刷日)/.test(text);
  }
  if (cm === 'exercise_record' || cm === 'body_condition_note') {
    return text.length >= 12
      && !/^なるほど。今の感じは受け取れた/.test(text)
      && !/(記録しました|いい流れです|ここまでの流れ)/.test(text);
  }
  if (cm === 'movement_goal_companion') {
    const ut = String(ctx.userText || '');
    const mg = ctx.movementGoalHints || {};
    if (/^(なるほど。今の感じは受け取れた|記録しました|いい流れです)/.test(text)) return false;
    if (/(診断です|診断されます|病名は|必ず治る|治療を開始)/.test(text)) return false;
    if (mg.block_self_care && /(ストレッチ|スクワット|筋トレ|10回|ジャンプ|走って)/.test(text) && !/(医療|受診|相談|病院|専門)/.test(text)) {
      return false;
    }
    if (mg.safety_assessment?.needsMedicalFirst && !/(医療|受診|相談|病院|専門)/.test(text)) return false;
    if (/痛|しびれ/.test(ut) && /(もっと|増や|追い込|頑張って).*(回|運動|スクワット)/.test(text)) return false;
    const safeLevel = mg.safety_level === movementSupportClassifier.SAFETY_LEVEL.SAFE_SELF_CARE
      || mg.safety_level === movementSupportClassifier.SAFETY_LEVEL.NEEDS_CAUTION;
    if (safeLevel && !/(\d+回|10秒|5回|30秒|中止|止め)/.test(text)) return false;
    if (safeLevel && /^(痛みが続く場合は病院|病院へ行ってください)[。]?$/.test(text.trim())) return false;
    const hasCue = /(ストレッチ|可動域|痛|腰|膝|肩|目標|整え|やさし|中止|フォーム|セルフ|自重|医療|相談|すね|骨盤|肩甲骨)/.test(text);
    return text.length >= 12 && hasCue;
  }
  return true;
}

async function generateProse(ctx) {
  const modeBlock = modeSystemInstructions(ctx.conversationMode, ctx.replyPolicy?.replyDepth);
  const conversationCoreBlock = buildConversationCorePromptBlock(ctx);
  const ushigomeBlock = ushigomeConversationStyleService.formatHintsForPrompt(ctx.ushigomeStyle);
  const movementBlock = ctx.movementGoalHints
    ? movementGoalCompanionService.formatMovementHintsForPrompt(ctx.movementGoalHints)
    : '';
  const hints = (ctx.observationHints || [])
    .map((h) => (typeof h === 'string' ? h : h?.hint))
    .filter(Boolean)
    .slice(0, 3);
  const featureSummary = JSON.stringify({
    saved: ctx.featureResults?.saved,
    items: ctx.featureResults?.items,
    recordKind: ctx.featureResults?.recordKind,
    stableRoutineEvidenceCount: ctx.userContext?.stableRoutineEvidenceCount,
    labFound: ctx.featureResults?.found,
    labItem: ctx.featureResults?.itemName,
    labQueryType: ctx.featureResults?.queryType,
  });

  const hiddenContext = [
    '[ここから。自然返信]',
    conversationCoreBlock,
    movementBlock,
    ushigomeBlock,
    modeBlock,
    hints.length ? `観察ヒント（使うかは文脈判断・そのまま貼らない）: ${hints.join(' / ')}` : null,
    `処理サマリ: ${featureSummary}`,
    '数値・kcal・今日の合計の行は絶対に書かない（後段で付与）。',
    '禁止: ここまでの流れを一本で見ています / 急がず今日はこの一歩で十分 / 雑談もちゃんと受け止めます / 健康の話に引き戻さなくて大丈夫 / 続きがあればそのまま送ってください / まずはここに送れただけで十分',
  ].filter(Boolean).join('\n');

  const raw = await aiChatService.generateReply({
    userMessage: ctx.userText,
    recentMessages: ctx.userContext?.recentMessages || [],
    responseMode: 'conversation_first',
    energyLevel: ctx.replyPolicy?.replyDepth === 'deep' ? 'low' : 'middle',
    hiddenContext,
    longMemory: ctx.userContext?.longMemory || {},
  });

  const prose = normalizeText(raw);
  if (prose && isAcceptableProse(ctx, prose)) {
    return { prose, source: 'openai' };
  }
  if (prose) {
    console.info('[line_natural_reply_quality_gate]', {
      conversation_mode: ctx.conversationMode,
      rejected_preview: prose.slice(0, 120),
      reason: 'openai_output_failed_mode_gate',
    });
  }
  return { prose: fallbackProse(ctx), source: 'rule_fallback' };
}

function buildLabDatesInventoryBlock(featureResults = {}) {
  const lines = Array.isArray(featureResults.formattedLines)
    ? featureResults.formattedLines.map((x) => normalizeText(x)).filter(Boolean)
    : [];
  return lines.join('\n');
}

function shouldAttachLabBlock(conversationMode, featureResults) {
  const cm = normalizeText(conversationMode);
  if (cm === 'lab_date_inventory') {
    const lines = Array.isArray(featureResults?.formattedLines) ? featureResults.formattedLines : [];
    return lines.length > 0;
  }
  if (cm === 'lab_comparison' || featureResults?.queryType === 'comparison') {
    const lines = Array.isArray(featureResults?.formattedLines) ? featureResults.formattedLines : [];
    return lines.length > 0;
  }
  if (cm !== 'lab_followup') return false;
  const lines = Array.isArray(featureResults?.formattedLines) ? featureResults.formattedLines : [];
  return lines.length > 0;
}

function shouldAttachNutritionBlock(conversationMode, featureResults) {
  const cm = normalizeText(conversationMode);
  if (!featureResults?.saved) return false;
  return /meal_text_record|meal_record_text|reward_food|meal_note|meal_text/.test(cm)
    || featureResults.recordKind === 'reward_food'
    || featureResults.recordKind === 'meal_text_record';
}

/**
 * LINE返信文の唯一の生成入口（自然文 + 許可された数値ブロックのみ）。
 */
async function generateNaturalLineReply(params = {}) {
  const ctx = replyContextBuilder.buildReplyContext(params);
  const { prose, source } = await generateProse(ctx);

  let text = prose;
  if (normalizeText(ctx.conversationMode) === 'movement_goal_companion') {
    const mg = ctx.movementGoalHints
      || movementGoalCompanionService.buildMovementGoalHints({
        userText: ctx.userText,
        conversationMode: ctx.conversationMode,
        userContext: ctx.userContext,
      });
    text = movementLifeSceneSelfcare.postProcessMovementReply({
      userText: ctx.userText,
      replyText: text,
      lifeScenePick: mg.life_scene_pick || null,
      reactionFollowup: mg.reaction_followup || null,
    });
  }
  text = enforceConversationCoreReply(ctx, text);
  if (shouldAttachNutritionBlock(ctx.conversationMode, ctx.featureResults)) {
    const numeric = buildManualNutritionBlock(ctx.featureResults);
    if (numeric) text = `${text}\n\n${numeric}`.trim();
  } else if (shouldAttachLabBlock(ctx.conversationMode, ctx.featureResults)) {
    const labBlock = ctx.conversationMode === 'lab_date_inventory'
      ? buildLabDatesInventoryBlock(ctx.featureResults)
      : buildLabValuesBlock(ctx.featureResults);
    if (labBlock) text = `${text}\n\n${labBlock}`.trim();
  }

  console.info('[line_natural_reply_generated]', {
    user_id: normalizeText(params.userId || ''),
    conversation_mode: ctx.conversationMode,
    source,
    has_numeric_block: shouldAttachNutritionBlock(ctx.conversationMode, ctx.featureResults),
    has_lab_block: shouldAttachLabBlock(ctx.conversationMode, ctx.featureResults),
    text_preview: text.slice(0, 160),
  });

  return {
    text: text.trim(),
    meta: { source, conversationMode: ctx.conversationMode },
  };
}

module.exports = {
  generateNaturalLineReply,
  buildManualNutritionBlock,
  buildLabValuesBlock,
  fallbackProse,
  postProcessMovementReply: movementLifeSceneSelfcare.postProcessMovementReply,
};
