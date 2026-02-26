require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

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

// ===== 重複イベント防止 =====
const processedEvents = new Set();

// ===== 動作確認 =====
app.get("/", (req, res) => {
  res.status(200).send("✅ LINE AIサーバー稼働中");
});

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
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

  // LINEに先に200を返す（タイムアウト防止）
  res.status(200).send("OK");

  for (const event of events) {
    if (
      event.type !== "message" ||
      event.message.type !== "text"
    ) continue;

    // 重複防止
    if (processedEvents.has(event.message.id)) continue;
    processedEvents.add(event.message.id);

    const userMessage = event.message.text;

    try {
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "あなたは丁寧で親切な整骨院の受付AIです。予約や症状相談に優しく対応してください。",
          },
          {
            role: "user",
            content: userMessage,
          },
        ],
        temperature: 0.6,
      });

      const replyText =
        aiResponse.choices[0].message.content || "申し訳ありません、もう一度お願いします。";

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [{ type: "text", text: replyText }],
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
          },
        }
      );

    } catch (error) {
      console.error("🔥 AIエラー:", error.message);

      // エラー時も必ず返信する（無言防止）
      try {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "現在混み合っています。少し時間をおいてもう一度お試しください。",
              },
            ],
          },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            },
          }
        );
      } catch (err) {
        console.error("返信失敗:", err.message);
      }
    }
  }
});

// ===== 404対策 =====
app.use((req, res) => {
  res.status(404).send("Not Found");
});

// ===== 起動 =====
const serverPort = PORT || 3000;
app.listen(serverPort, () => {
  console.log(`🚀 Server running on port ${serverPort}`);
});