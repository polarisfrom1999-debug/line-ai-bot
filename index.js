require("dotenv").config();
const express = require("express");
const OpenAI = require("openai");

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("AIサーバー起動中です！");
});

app.get("/ask", async (req, res) => {
  const question = req.query.q;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
    });

    res.json(response.choices[0].message);
  } catch (error) {
    console.error(error);
    res.send("エラーが発生しました");
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});