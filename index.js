require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const OpenAI = require("openai");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const ChartJSNodeCanvas = require("chartjs-node-canvas");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const app = express();
app.use(express.json());

// ===== 環境変数 =====
const {
  OPENAI_API_KEY,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  PORT,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY,
  SPREADSHEET_ID
} = process.env;

if (
  !OPENAI_API_KEY ||
  !LINE_CHANNEL_ACCESS_TOKEN ||
  !LINE_CHANNEL_SECRET ||
  !GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  !GOOGLE_PRIVATE_KEY ||
  !SPREADSHEET_ID
) {
  console.error("❌ 環境変数不足");
  process.exit(1);
}

// ===== LINE署名チェック用 =====
const verifySignature = (body, signature) => {
  const hash = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");
  return hash === signature;
};

// ===== OpenAI =====
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ===== 重複イベント防止 =====
const processedEvents = new Set();

// ===== Googleスプレッドシート =====
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);
const initSpreadsheet = async () => {
  try {
    await doc.useServiceAccountAuth({
      client_email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    });
    await doc.loadInfo();
    console.log("✅ スプレッドシート接続成功:", doc.title);
  } catch (err) {
    console.error("❌ スプレッドシート接続エラー:", err.message);
  }
};

// ===== ChartJS設定 =====
const width = 800;
const height = 400;
const chartCallback = (ChartJS) => {
  // Chart.js global options if needed
};
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback });

// ===== サーバー起動確認 =====
app.get("/", (req, res) => res.send("✅ LINE AIサーバー稼働中"));

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  const body = JSON.stringify(req.body);

  if (!verifySignature(body, signature)) {
    console.log("❌ LINE署名エラー");
    return res.status(403).send("Forbidden");
  }

  res.status(200).send("OK"); // タイムアウト防止

  const events = req.body.events;

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") continue;
    if (processedEvents.has(event.message.id)) continue;
    processedEvents.add(event.message.id);

    const userMessage = event.message.text;

    try {
      // ===== AI応答 =====
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
あなたは整骨院の院長AIです。56歳で患者さんに優しく寄り添います。
患者さんの発言を引用しながら共感し、焦らずステップアップ方式で助言し、努力を褒め、最後に前向きなメッセージで締めます。
`
          },
          { role: "user", content: userMessage }
        ],
        temperature: 0.6
      });

      const replyText =
        aiResponse.choices?.[0]?.message?.content ||
        "申し訳ありません、もう一度お願いします。";

      // ===== スプレッドシート記録 =====
      await initSpreadsheet();
      const sheet = doc.sheetsByIndex[0]; // 最初のシート
      await sheet.addRow({
        timestamp: new Date().toISOString(),
        userId: event.source.userId,
        message: userMessage
      });

      // ===== グラフ生成とPDF化（例: 体重履歴） =====
      const rows = await sheet.getRows();
      const userRows = rows.filter(r => r.userId === event.source.userId);
      const labels = userRows.map(r => new Date(r.timestamp).toLocaleDateString());
      const weights = userRows.map(r => parseFloat(r.weight || 0));

      if (weights.length > 1) {
        const configuration = {
          type: "line",
          data: { labels, datasets: [{ label: "体重(kg)", data: weights, borderColor: "blue", fill: false }] }
        };
        const chartBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);

        const pdfPath = path.join(__dirname, `./${event.source.userId}_weight.pdf`);
        const pdfDoc = new PDFDocument();
        pdfDoc.pipe(fs.createWriteStream(pdfPath));
        pdfDoc.text("体重推移", { align: "center" });
        pdfDoc.image(chartBuffer, { fit: [500, 300], align: "center" });
        pdfDoc.end();

        // ===== LINE送信（PDFはURL化などで送信可能） =====
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text: replyText }]
          },
          { headers: { "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
        );
      } else {
        // データが少なければテキストのみ送信
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text: replyText }]
          },
          { headers: { "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
        );
      }

    } catch (error) {
      console.error("🔥 エラー:", error.message);
      try {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: event.replyToken,
            messages: [{ type: "text", text: "現在混み合っています。少し時間をおいてもう一度お試しください。" }]
          },
          { headers: { "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
        );
      } catch (err) {
        console.error("返信失敗:", err.message);
      }
    }
  }
});

// ===== 404対策 =====
app.use((req, res) => res.status(404).send("Not Found"));

// ===== 起動 =====
const serverPort = PORT || 3000;
<<<<<<< HEAD
app.listen(serverPort, () => console.log(`🚀 Server running on port ${serverPort}`));
=======
app.listen(serverPort, () => console.log(`🚀 Server running on port ${serverPort}`));
>>>>>>> afc7c3c (Prepare for pull: save local changes)
