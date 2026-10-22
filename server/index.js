import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'calls.json');
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) : null;
const TABLE = 'voice_sales_calls';
const BUCKET = 'call-recordings';
await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(UPLOAD_DIR, { recursive: true });
try { await fs.access(DB_FILE); } catch { await fs.writeFile(DB_FILE, '[]'); }

const app = express();
const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(s => s.trim().replace(/\/+$/, ''));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*')) return callback(null, true);
    const cleanOrigin = origin.replace(/\/+$/, '');
    return callback(null, allowedOrigins.includes(cleanOrigin));
  },
  credentials: false
}));
app.use(express.json({ limit: '4mb' }));
app.use('/recordings', express.static(UPLOAD_DIR));
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

app.get('/', (_req, res) => res.json({
  ok: true,
  name: 'VoxPilot AI Sales Studio API',
  provider: 'Groq',
  endpoints: {
    health: '/api/health',
    calls: '/api/calls',
    chat: '/api/chat'
  }
}));


async function readCalls() {
  if (supabase) { const { data, error } = await supabase.from(TABLE).select('id,data').order('created_at', { ascending: false }); if (error) throw new Error(`Supabase read failed: ${error.message}`); return (data || []).map(row => row.data); }
  return JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
}
async function writeCalls(calls) {
  if (supabase) { const rows = calls.map(call => ({ id: call.id, data: call, created_at: call.createdAt || new Date().toISOString() })); const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' }); if (error) throw new Error(`Supabase write failed: ${error.message}`); return; }
  await fs.writeFile(DB_FILE, JSON.stringify(calls, null, 2));
}
const allowedStatuses = ['Converted', 'Interested', 'Follow-up Required', 'Not Interested', 'Demo Requested', 'No Response'];
const productFallback = { name: 'CloudDesk', description: 'A fictional SaaS workspace for teams to organize projects, automate routine updates, and keep conversations in one place.', features: ['Project and task tracking', 'Automated team updates', 'Shared team workspace'], pricing: 'Sample demo pricing: plans start at ₹799 per user/month.' };

function extractJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const clean = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace >= firstBrace) {
    return clean.slice(firstBrace, lastBrace + 1);
  }
  return clean;
}

async function groqChat(messages, options = {}) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is missing. Add a key from https://console.groq.com/ to server/.env.');
  const model = options.model || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
  const payload = {
    model,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.max_tokens ?? 500,
    messages,
    ...(options.json ? { response_format: { type: 'json_object' } } : {})
  };
  if (options.reasoning_effort) payload.reasoning_effort = options.reasoning_effort;

  const sendRequest = async (body) => {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  };

  let res = await sendRequest(payload);

  // If reasoning_effort was rejected by the model, retry once without it
  if (!res.ok && payload.reasoning_effort && res.data?.error?.message?.includes('reasoning_effort')) {
    delete payload.reasoning_effort;
    res = await sendRequest(payload);
  }

  // If json response_format was rejected or validation failed, retry once without response_format
  if (!res.ok && payload.response_format && (res.data?.error?.message?.includes('response_format') || res.data?.error?.code === 'json_validate_failed')) {
    delete payload.response_format;
    res = await sendRequest(payload);
  }

  if (!res.ok) {
    const message = res.data?.error?.message || `Groq request failed (${res.status}). Check model access and free-tier limits.`;
    const err = new Error(message);
    err.status = res.status;
    err.code = res.data?.error?.code;
    err.type = res.data?.error?.type;
    throw err;
  }
  return res.data?.choices?.[0]?.message?.content?.trim() || '';
}

async function analyzeCallTranscript(transcript = [], productName = 'CloudDesk') {
  const fallback = {
    summary: 'Summary unavailable. Check Groq API configuration and retry.',
    requirements: [],
    objections: [],
    nextSteps: ['Review the transcript and follow up if appropriate.'],
    status: transcript.some(m => m.role === 'customer') ? 'Follow-up Required' : 'No Response',
    rationale: 'Fallback classification because AI analysis was unavailable.'
  };

  if (!Array.isArray(transcript) || transcript.length === 0) {
    return fallback;
  }

  try {
    const prompt = `Analyze this SaaS sales call. Return a JSON object with the following exact keys:
- "summary": concise string summarizing the conversation (2-4 sentences)
- "requirements": array of strings listing customer pain points, goals, or requirements
- "objections": array of strings listing objections or concerns raised by customer
- "nextSteps": array of strings with recommended action items for sales follow-up
- "status": exactly one string from: ${JSON.stringify(allowedStatuses)}
- "rationale": concise string explaining why this status was chosen

Status criteria:
- "Converted": Only if customer explicitly confirmed purchase or signup.
- "Demo Requested": Only if a demo was explicitly requested or agreed to.
- "Not Interested": Customer explicitly declined or stated no interest.
- "Interested": Customer showed clear buying intent or engaged enthusiasm.
- "Follow-up Required": General questions, inquiry, or conversation requiring follow-up.
- "No Response": Customer provided no meaningful replies.

Base your analysis strictly on the transcript. Do not invent facts.
Product: ${productName}
Transcript:
${JSON.stringify(transcript).slice(0, 18000)}`;

    const content = await groqChat([
      { role: 'system', content: 'You are an expert sales operations analyst. You must return valid JSON only. Never wrap response in explanation or markdown.' },
      { role: 'user', content: prompt }
    ], {
      temperature: 0.1,
      max_tokens: 2048,
      reasoning_effort: 'low',
      json: true
    });

    const rawJson = extractJson(content);
    if (!rawJson) throw new Error('Failed to extract JSON from AI response.');

    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Parsed AI response is not a valid JSON object.');
    }

    const toStringArray = (val) => Array.isArray(val) ? val.map(x => typeof x === 'string' ? x.trim() : String(x)).filter(Boolean) : [];

    const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : null;
    if (!summary) throw new Error('AI response is missing required "summary" string.');

    const status = allowedStatuses.includes(parsed.status)
      ? parsed.status
      : (transcript.some(m => m.role === 'customer') ? 'Follow-up Required' : 'No Response');

    const rationale = typeof parsed.rationale === 'string' && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : 'AI sales classification based on conversation transcript.';

    return {
      summary,
      requirements: toStringArray(parsed.requirements),
      objections: toStringArray(parsed.objections),
      nextSteps: toStringArray(parsed.nextSteps).length ? toStringArray(parsed.nextSteps) : ['Follow up with customer based on call findings.'],
      status,
      rationale
    };
  } catch (e) {
    console.error(`AI analysis failed: ${e.message}`, {
      status: e.status || 500,
      code: e.code || 'ANALYSIS_ERROR',
      type: e.type || 'EXECUTION_ERROR'
    });
    return fallback;
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, provider: 'Groq', configured: Boolean(process.env.GROQ_API_KEY), persistence: supabase ? 'Supabase PostgreSQL + Storage' : 'Local JSON (development only)' }));

app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], product = productFallback, language = 'auto' } = req.body || {};
    if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array.' });
    const safeMessages = messages.slice(-16).filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 3000) }));
    const system = `You are VoxPilot, a warm, consultative SaaS sales representative. Product: ${product.name || productFallback.name}. Description: ${product.description || productFallback.description}. Features: ${(product.features || productFallback.features).join('; ')}. Pricing: ${product.pricing || productFallback.pricing}. These are demo product details; never invent features, discounts, customer claims, guarantees, or prices. Ask one question at a time, discover needs, answer honestly, handle objections kindly, and suggest a demo or signup only when appropriate. Never claim a purchase or signup occurred. Keep spoken replies concise (1-3 sentences). Reply in the customer's language; support English and Hindi. Language preference: ${language}.`;
    const reply = await groqChat([{ role: 'system', content: system }, ...safeMessages], { max_tokens: 220 });
    res.json({ reply });
  } catch (e) { res.status(502).json({ error: e.message || 'Could not generate a response.' }); }
});

app.post('/api/calls/:id/recording', upload.single('recording'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No recording was received.' });
  const ext = req.file.mimetype?.includes('mp4') ? '.mp4' : '.webm';
  const filename = `${path.basename(req.params.id)}${ext}`;
  let recordingUrl;
  if (supabase) {
    const bytes = await fs.readFile(req.file.path);
    const { error } = await supabase.storage.from(BUCKET).upload(filename, bytes, { contentType: req.file.mimetype || 'audio/webm', upsert: true });
    await fs.rm(req.file.path, { force: true });
    if (error) return res.status(500).json({ error: `Supabase Storage upload failed: ${error.message}. Ensure the '${BUCKET}' bucket exists and is public.` });
    recordingUrl = supabase.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
  } else {
    const finalPath = path.join(UPLOAD_DIR, filename); await fs.rename(req.file.path, finalPath); recordingUrl = `/recordings/${filename}`;
  }
  const calls = await readCalls(); const call = calls.find(c => c.id === req.params.id);
  if (call) { call.recordingUrl = recordingUrl; await writeCalls(calls); }
  res.json({ recordingUrl });
});

app.post('/api/calls', async (req, res) => {
  const { id, startedAt, endedAt, durationSeconds, transcript = [], customerName = '', productName = 'CloudDesk', recordingUrl = null } = req.body || {};
  if (!id || !Array.isArray(transcript)) return res.status(400).json({ error: 'A call id and transcript are required.' });
  const analysis = await analyzeCallTranscript(transcript, productName);
  const call = { id, customerName: customerName || 'Guest customer', productName, startedAt: startedAt || new Date().toISOString(), endedAt: endedAt || new Date().toISOString(), durationSeconds: Number(durationSeconds || 0), transcript, ...analysis, recordingUrl, createdAt: new Date().toISOString() };
  const calls = await readCalls();
  const existing = calls.findIndex(c => c.id === id);
  if (existing >= 0) calls[existing] = { ...calls[existing], ...call }; else calls.unshift(call);
  await writeCalls(calls);
  res.json({ call });
});

app.post('/api/calls/:id/analyze', async (req, res) => {
  const calls = await readCalls();
  const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Call not found.' });
  const analysis = await analyzeCallTranscript(call.transcript, call.productName);
  Object.assign(call, analysis);
  await writeCalls(calls);
  res.json({ call });
});
app.get('/api/calls', async (_req, res) => res.json({ calls: await readCalls() }));
app.get('/api/calls/:id', async (req, res) => { const call = (await readCalls()).find(c => c.id === req.params.id); call ? res.json({ call }) : res.status(404).json({ error: 'Call not found.' }); });
app.delete('/api/calls/:id', async (req, res) => {
  const calls = await readCalls(); const call = calls.find(c => c.id === req.params.id);
  if (!call) return res.status(404).json({ error: 'Call not found.' });
  if (call.recordingUrl && !call.recordingUrl.startsWith('http')) await fs.rm(path.join(UPLOAD_DIR, path.basename(call.recordingUrl)), { force: true });
  if (supabase && call.recordingUrl?.startsWith('http')) { const fileName = new URL(call.recordingUrl).pathname.split('/').pop(); if (fileName) await supabase.storage.from(BUCKET).remove([fileName]); }
  if (supabase) { const { error } = await supabase.from(TABLE).delete().eq('id', req.params.id); if (error) return res.status(500).json({ error: error.message }); }
  else await writeCalls(calls.filter(c => c.id !== req.params.id));
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`VoxPilot API listening on port ${port}`));
