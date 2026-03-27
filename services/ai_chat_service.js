'use strict';
const OpenAI = require('openai');
const { buildTimeAnswer } = require('./time_service');
const FORBIDDEN_PHRASES=['報告ありがとうございます','素晴らしいです','引き続き頑張りましょう','しっかりできています','管理できています'];
const BASE_SYSTEM_PROMPT=`あなたは「ここから。」のAI牛込です。ダイエットを入口にした人生伴走OSとして振る舞ってください。会話は自然で、LINE向けに少し短くしてください。管理者のような言い方を避けてください。提案は多くて1つまでにしてください。雑談や相談をすぐ記録処理に変えないでください。重い話は軽く流さず、まず受け止めてください。`;
function getClient(){ const apiKey=process.env.OPENAI_API_KEY||''; if(!apiKey) return null; return new OpenAI({ apiKey }); }
function buildResponseModeInstruction(mode){ if(mode==='empathy_only') return '今回は提案を入れず、受け止め中心で返してください。'; if(mode==='deep_support') return '重さを軽く扱わず、まず受け止めてください。'; if(mode==='casual_talk') return '健康指導へ急に戻さず、自然な雑談として返してください。'; return 'まず受け止めを置き、必要なら提案は1つだけにしてください。'; }
function buildSystemPrompt(params){ return [params.hiddenContext||'', buildResponseModeInstruction(params.responseMode), BASE_SYSTEM_PROMPT].filter(Boolean).join('

'); }
function removeForbiddenPhrases(text){ let next=String(text||''); for (const phrase of FORBIDDEN_PHRASES) next=next.replaceAll(phrase,''); return next; }
function normalizeLineBreaks(text){ return String(text||'').replace(/
{3,}/g,'

').trim(); }
function fallbackGenerate(userMessage){ const text=String(userMessage||''); if(/今何時|何時|何月何日|今日何日/.test(text)) return buildTimeAnswer(); if(/疲れ|眠い|寝不足/.test(text)) return '今日は少し消耗が強そうですね。無理に整えにいくより、まずは減らしすぎず休める所を一つ作れたら十分です。'; if(/不安|つらい|しんどい|苦しい/.test(text)) return 'それはしんどいですね。まずは今そう感じていることを、そのまま受け取っています。無理に整えようとしなくて大丈夫です。'; if(/食べた|朝ごはん|昼ごはん|夜ごはん|ラーメン|寿司|卵|味噌汁/.test(text)) return '受け取りました。食事の流れとして見ていきますね。'; if(/歩いた|ジョギング|ランニング|運動|スクワット/.test(text)) return '動けた分、ちゃんと積み上がっていますね。今日はそこを受け取っておいて大丈夫です。'; return 'はい、受け取りました。今の流れを踏まえて、一緒に見ていきますね。'; }
async function callOpenAI(messages){ const client=getClient(); if(!client) return fallbackGenerate(messages[messages.length-1]?.content||''); const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),12000); try{ const response=await client.chat.completions.create({ model: process.env.OPENAI_MODEL||'gpt-4.1-mini', temperature:0.8, messages }, { signal: controller.signal }); return response?.choices?.[0]?.message?.content || fallbackGenerate(messages[messages.length-1]?.content||''); }catch(error){ console.error('[ai_chat_service] callOpenAI error:', error?.message||error); return fallbackGenerate(messages[messages.length-1]?.content||''); }finally{ clearTimeout(timeout); } }
async function generateReply(params){ const systemPrompt=buildSystemPrompt(params); const messages=[{role:'system',content:systemPrompt}, ...(Array.isArray(params.recentMessages)?params.recentMessages.slice(-12).map(m=>({role:m.role,content:String(m.content||'')})):[]), {role:'user',content:String(params.userMessage||'')}]; const raw=await callOpenAI(messages); return normalizeLineBreaks(removeForbiddenPhrases(raw)); }
module.exports = { generateReply };
