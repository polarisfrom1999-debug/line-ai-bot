require("dotenv").config();

const express = require("express");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ====== 環境変数 ======
const PORT = process.env.PORT || 10000;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ====== OpenAI設定 ======
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// ====== 会話履歴保存（簡易メモリ） ======
const userMemory = {};

// ====== ルート確認 ======
app.get("/", (req, res) => {
  res.send("LINE AI Bot is running ✅");
});

// ====== LINE Webhook ======
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type !== "message" || event.message.type !== "text") continue;

      const userId = event.source.userId;
      const userMessage = event.message.text;

      if (!userMemory[userId]) {
        userMemory[userId] = [];
      }

      userMemory[userId].push({ role: "user", content: userMessage });

      let replyText = "";

      // ====== 予約誘導ロジック ======
      if (
        userMessage.includes("予約") ||
        userMessage.includes("電話") ||
        userMessage.includes("痛い")
      ) {
        replyText =
          "ご予約や症状の詳しいご相談はお電話がスムーズです。\n📞 03-3877-6116 までお電話ください。";
      }

      // ====== Gemini切替 ======
      else if (userMessage.startsWith("/gemini")) {
        const geminiPrompt = userMessage.replace("/gemini", "").trim();

        const geminiResponse = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            contents: [
              {
                parts: [{ text: geminiPrompt }],
              },
            ],
          }
        );

        replyText =
          geminiResponse.data.candidates[0].content.parts[0].text;
      }

      // ====== 通常はOpenAI ======
      else {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "あなたは整骨院のAI受付です。丁寧で安心感のある返答をしてください。",
            },
            ...userMemory[userId],
          ],
        });

        replyText = completion.choices[0].message.content;
      }

      userMemory[userId].push({ role: "assistant", content: replyText });

      // ====== LINEへ返信 ======
      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: replyText,
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
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("エラー詳細:", error.response?.data || error.message);
    res.status(500).send("Error");
  }
});

// ====== サーバー起動 ======
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});