require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { createCanvas } = require("canvas");
const OpenAI = require("openai");

const app = express();
app.use(express.json({ limit: "10mb" })); // 画像対応

// ===== 環境変数 =====
const {
  OPENAI_API_KEY,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  PORT
} = process.env;

if (!OPENAI_API_KEY || !LINE_CHANNEL_ACCESS_TOKEN || !LINE_CHANNEL_SECRET) {
  console.error("❌ 環境変数不足");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const LINE_HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
};

// ===== 重複イベント防止 =====
const processedEvents = new Set();

// ===== データ保存ディレクトリ =====
const DATA_DIR = path.join(__dirname, "patients_data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ===== サーバー稼働確認 =====
app.get("/", (req, res) => {
  res.status(200).send("✅ LINE AIサーバー稼働中");
});

// ===== グラフ作成関数 =====
function createLineGraph(data, label, color = "#FF5733") {
  const width = 400, height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  // 軸
  ctx.strokeStyle = "#000";
  ctx.beginPath();
  ctx.moveTo(50, 10);
  ctx.lineTo(50, 250);
  ctx.lineTo(390, 250);
  ctx.stroke();

  // データ描画
  ctx.strokeStyle = color;
  ctx.beginPath();
  const stepX = 340 / (data.length - 1 || 1);
  data.forEach((v, i) => {
    const x = 50 + stepX * i;
    const y = 250 - (v / Math.max(...data)) * 200;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ラベル
  ctx.fillStyle = "#000";
  ctx.font = "16px Arial";
  ctx.fillText(label, 50, 280);

  return canvas.toBuffer("image/png");
}

// ===== LINE Webhook =====
app.post("/webhook", async (req, res) => {
  try {
    // 署名確認
    const signature = req.headers["x-line-signature"];
    const body = JSON.stringify(req.body);
    const hash = crypto
      .createHmac("sha256", LINE_CHANNEL_SECRET)
      .update(body)
      .digest("base64");
    if (hash !== signature) {
      console.log("❌ 署名エラー");
      return res.status(403).send("Forbidden");
    }

    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    // 先に200を返す（タイムアウト回避）
    res.status(200).send("OK");

    for (const event of events) {
      // 重複イベント防止
      if (processedEvents.has(event.message?.id)) continue;
      processedEvents.add(event.message?.id);

      const userId = event.source.userId;
      const userFile = path.join(DATA_DIR, `${userId}.json`);

      // 患者データ読み込み
      let patientData = { history: [], weight: [], fat: [], exercise: [], calories: [] };
      if (fs.existsSync(userFile)) {
        patientData = JSON.parse(fs.readFileSync(userFile, "utf-8"));
      }

      // ===== テキストメッセージ =====
      if (event.type === "message" && event.message.type === "text") {
        const userMessage = event.message.text;
        patientData.history.push({ timestamp: Date.now(), message: userMessage });
        fs.writeFileSync(userFile, JSON.stringify(patientData, null, 2));

        // AI返信生成
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたは整骨院の院長です。56歳で患者さんに最大限寄り添います。
患者の言葉を引用して「なるほど、○○ですね」と自然に共感してください。
- 体重、体脂肪率、運動量、摂取カロリーは努力を褒める
- 過去データを参照して進捗や変化をコメント
- 不安や落ち込みを和らげ、焦らず一歩ずつ改善する方法を提案
- 最後は前向きに励ます
            `
            },
            { role: "user", content: userMessage }
          ]
        });

        const aiReply = completion.choices[0].message.content;

        // グラフ画像作成（体重）
        const messagesToSend = [{ type: "text", text: aiReply }];
        if (patientData.weight.length > 0) {
          const graphBuffer = createLineGraph(patientData.weight, "体重推移");
          const imageBase64 = graphBuffer.toString("base64");
          messagesToSend.unshift({
            type: "image",
            originalContentUrl: `data:image/png;base64,${imageBase64}`,
            previewImageUrl: `data:image/png;base64,${imageBase64}`,
          });
        }

        // LINEに返信
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          { replyToken: event.replyToken, messages: messagesToSend },
          { headers: LINE_HEADERS }
        );
      }

      // ===== 写真メッセージ（食事） =====
      if (event.type === "message" && event.message.type === "image") {
        const messageId = event.message.id;
        const imageResponse = await axios.get(
          `https://api-data.line.me/v2/bot/message/${messageId}/content`,
          { headers: LINE_HEADERS, responseType: "arraybuffer" }
        );

        // AIに食事画像を送ってカロリー推定
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたは整骨院の院長です。患者さんの食事画像からおおよそのカロリーを推定してください。
患者にわかりやすく励ましを添えて伝える
              `
            },
            { role: "user", content: "[患者の食事画像]" }
          ]
        });

        const estimatedCalories = parseInt(completion.choices[0].message.content.match(/\d+/)?.[0] || "0");
        patientData.calories.push(estimatedCalories);
        fs.writeFileSync(userFile, JSON.stringify(patientData, null, 2));

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              { type: "text", text: 食事のカロリーは約 ${estimatedCalories} kcal です。よく頑張りました！ }
            ]
          },
          { headers: LINE_HEADERS }
        );
      }
    }
  } catch (error) {
    console.error("🔥 Webhook処理エラー:", error.message);
  }
});

// ===== 404対策 =====
app.use((req, res) => res.status(404).send("Not Found"));

// ===== サーバ起動 =====
const serverPort = PORT || 3000;
app.listen(serverPort, () => console.log(`🚀 Server running on port ${serverPort}`));
