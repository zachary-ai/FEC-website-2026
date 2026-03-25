const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { loadKnowledgeBase } = require('./lib/knowledge');

const app = express();
const PORT = process.env.PORT || 3001;

// Load knowledge base at startup
let SYSTEM_PROMPT;
try {
  SYSTEM_PROMPT = loadKnowledgeBase();
} catch (err) {
  console.error('Failed to load knowledge base:', err);
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────
// FIX [Critical]: No hardcoded fallback. FEC_TOKEN must be set as env var.
const FEC_TOKEN = process.env.FEC_TOKEN;
if (!FEC_TOKEN) {
  console.error('FEC_TOKEN env var is required. Exiting.');
  process.exit(1);
}

// Separate admin token for /questions dashboard (required)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN env var is required. Exiting.');
  process.exit(1);
}

const DAILY_REQUEST_CAP = parseInt(process.env.DAILY_REQUEST_CAP, 10) || 500;
const RATE_LIMIT_PER_MIN = 10;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONVERSATION_LENGTH = 20;
const ALERT_THRESHOLD = Math.floor(DAILY_REQUEST_CAP * 0.8);

// ── Middleware ─────────────────────────────────────────────────
// FIX [High]: Trust proxy so Railway sets req.ip correctly from its load balancer
app.set('trust proxy', 1);

app.use(cors({
  origin: [
    'https://thefractionalexec.com.au',
    'http://localhost:8888',
    'http://127.0.0.1:8888',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));

// ── IP Resolution ─────────────────────────────────────────────
// FIX [High]: With trust proxy enabled, req.ip uses the trusted proxy chain.
// Don't parse X-Forwarded-For manually.
function getClientIP(req) {
  return req.ip || 'unknown';
}

// ── Rate Limiting (per IP, per minute) ────────────────────────
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start > 60000) {
    entry = { count: 0, start: now };
  }
  entry.count += 1;
  rateLimitStore.set(ip, entry);
  return entry.count <= RATE_LIMIT_PER_MIN;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.start > 300000) rateLimitStore.delete(ip);
  }
}, 300000);

// ── Daily Request Cap ─────────────────────────────────────────
let dailyRequestCount = 0;
let dailyResetDate = new Date().toDateString();
let alertSent = false;

function checkDailyCap() {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyRequestCount = 0;
    dailyResetDate = today;
    alertSent = false;
    console.log('[DAILY] Counter reset for new day');
  }
  dailyRequestCount++;

  if (!alertSent && dailyRequestCount >= ALERT_THRESHOLD) {
    alertSent = true;
    console.warn(`[ALERT] Daily usage at ${dailyRequestCount}/${DAILY_REQUEST_CAP}. Approaching cap.`);
    slackCapWarning();
  }

  if (dailyRequestCount > DAILY_REQUEST_CAP) {
    if (dailyRequestCount === DAILY_REQUEST_CAP + 1) slackCapHit();
    console.error(`[ALERT] Daily cap EXCEEDED. Blocking requests.`);
    return false;
  }
  return true;
}

// ── Question Log ──────────────────────────────────────────────
const questionLog = [];
const MAX_LOG_SIZE = 500;

function logQuestion(question, ip, isUnlimited) {
  const entry = {
    question: question,
    timestamp: new Date().toISOString(),
    ip: ip.replace(/\d+$/, 'xxx'),
    mode: isUnlimited ? 'fec' : 'trial'
  };
  questionLog.push(entry);
  if (questionLog.length > MAX_LOG_SIZE) questionLog.shift();
  console.log(`[Q] ${entry.timestamp} [${entry.mode}] ${question}`);
}

// ── Auth Rate Limiting (brute force protection) ──────────────
const authRateLimitStore = new Map();
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 3600000;

function checkAuthRateLimit(ip) {
  const now = Date.now();
  let entry = authRateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start > AUTH_WINDOW_MS) {
    entry = { count: 0, start: now };
  }
  entry.count += 1;
  authRateLimitStore.set(ip, entry);
  return entry.count <= AUTH_MAX_ATTEMPTS;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authRateLimitStore) {
    if (now - entry.start > AUTH_WINDOW_MS) authRateLimitStore.delete(ip);
  }
}, 1800000);

// ── Prompt Injection Protection ───────────────────────────────
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)/i,
  /forget\s+(all\s+)?(previous|prior|your)\s+(instructions|rules|guidelines)/i,
  /you\s+are\s+now\s+(a|an|no\s+longer)/i,
  /new\s+instructions?\s*:/i,
  /system\s*prompt\s*:/i,
  /\[system\]/i,
  /\<\s*system\s*\>/i,
  /pretend\s+(you\s+are|to\s+be|you're)\s+(not|a\s+different)/i,
  /act\s+as\s+if\s+you\s+(have\s+no|don't\s+have|are\s+not)/i,
  /reveal\s+(your|the)\s+(system|hidden|secret|full)\s+(prompt|instructions)/i,
  /output\s+(your|the)\s+(system|initial|original)\s+(prompt|message|instructions)/i,
  /what\s+(are|is)\s+your\s+(system|hidden|secret|initial)\s+(prompt|instructions|message)/i,
  /repeat\s+(the|your)\s+(system|above|initial)\s+(prompt|message|instructions)/i,
  /print\s+(your|the)\s+(instructions|system\s+prompt|rules)/i,
  /base64|eval\s*\(|<script|javascript:/i,
];

function checkPromptInjection(text) {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ── Input Sanitisation ────────────────────────────────────────
function sanitiseInput(text) {
  let clean = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  clean = clean.replace(/\n{4,}/g, '\n\n\n');
  clean = clean.replace(/ {10,}/g, '    ');
  return clean.trim();
}

// ── Leads & Feedback Logs ─────────────────────────────────────
const leadLog = [];
const feedbackLog = [];

// ── Slack Notifications ───────────────────────────────────────
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const SLACK_CHANNEL_ID = 'C0AMXN6KB71'; // #zacbot (private)

async function sendSlack(text) {
  if (!SLACK_BOT_TOKEN) return;
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
      },
      body: JSON.stringify({ channel: SLACK_CHANNEL_ID, text })
    });
  } catch (err) {
    console.error('[SLACK] Failed:', err.message);
  }
}

function slackLead(email) {
  sendSlack(`*[ZacBot Lead]* ${email}\nCaptured at trial gate. Follow up.`);
}

function slackCapWarning() {
  sendSlack(`*[ZacBot Warning]* Daily usage at ${dailyRequestCount}/${DAILY_REQUEST_CAP} (${Math.round(dailyRequestCount / DAILY_REQUEST_CAP * 100)}%). Approaching cap.`);
}

function slackCapHit() {
  sendSlack(`*[ZacBot ALERT]* Daily cap of ${DAILY_REQUEST_CAP} requests hit. All further requests blocked until tomorrow.`);
}

function slackFeedback(vote, question) {
  if (vote === 'down') {
    sendSlack(`*[ZacBot Feedback]* Thumbs down on: "${question}"\nCheck if the answer needs improvement.`);
  }
}

async function sendDailySlackSummary() {
  const topQuestions = questionLog.slice(-50).map(q => q.question).slice(0, 10);
  const thumbsUp = feedbackLog.filter(f => f.vote === 'up').length;
  const thumbsDown = feedbackLog.filter(f => f.vote === 'down').length;
  const todayLeads = leadLog.filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString());

  const text = [
    `*ZacBot Daily Summary (${new Date().toLocaleDateString('en-AU')})*`,
    `Requests: ${dailyRequestCount}/${DAILY_REQUEST_CAP}`,
    `Leads: ${todayLeads.length}${todayLeads.length > 0 ? ' (' + todayLeads.map(l => l.email).join(', ') + ')' : ''}`,
    `Feedback: ${thumbsUp} up, ${thumbsDown} down`,
    topQuestions.length > 0 ? `\n*Recent questions:*\n${topQuestions.map((q, i) => `${i + 1}. ${q.substring(0, 100)}`).join('\n')}` : ''
  ].join('\n');

  await sendSlack(text);
  console.log('[SLACK] Daily summary sent');
}

// 6pm AEST (8:00 UTC)
setInterval(() => {
  const now = new Date();
  if (now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
    sendDailySlackSummary();
  }
}, 300000);

// ── Active Streams (for cancellation) ─────────────────────────
// FIX [Medium]: Track active streams so we can abort on client disconnect
const activeStreams = new Map();
let streamIdCounter = 0;

// ── Routes ────────────────────────────────────────────────────

// Health check (no sensitive data exposed)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ZacBot API' });
});

// FIX [Critical]: Dashboard uses separate ADMIN_TOKEN
app.get('/questions', (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({
    total: questionLog.length,
    daily_requests: dailyRequestCount,
    daily_cap: DAILY_REQUEST_CAP,
    questions: questionLog.slice().reverse(),
    leads: leadLog.slice().reverse(),
    feedback: feedbackLog.slice().reverse()
  });
});

// Capture email lead
app.post('/lead', (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ error: 'Invalid email.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const entry = { email: cleanEmail, timestamp: new Date().toISOString() };
  leadLog.push(entry);
  console.log(`[LEAD] ${entry.timestamp} - ${cleanEmail}`);
  slackLead(cleanEmail);
  res.json({ ok: true });
});

// Record feedback
app.post('/feedback', (req, res) => {
  const { question, answer, vote } = req.body;
  if (!vote || !['up', 'down'].includes(vote)) {
    return res.status(400).json({ error: 'Invalid feedback.' });
  }
  const entry = {
    question: (question || '').substring(0, 200),
    answer: (answer || '').substring(0, 200),
    vote,
    timestamp: new Date().toISOString()
  };
  feedbackLog.push(entry);
  console.log(`[FEEDBACK] ${entry.timestamp} [${vote}] Q: ${entry.question}`);
  slackFeedback(vote, entry.question);
  res.json({ ok: true });
});

// Token validation (rate limited to prevent brute force)
app.post('/auth', (req, res) => {
  const clientIP = getClientIP(req);

  if (!checkAuthRateLimit(clientIP)) {
    console.warn(`[AUTH] Rate limited: ${clientIP}`);
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }

  const { token } = req.body;
  if (token && token === FEC_TOKEN) {
    return res.json({ unlimited: true });
  }

  console.log(`[AUTH] Failed attempt from ${clientIP.replace(/\d+$/, 'xxx')}`);
  return res.json({ unlimited: false });
});

// Chat endpoint with streaming
app.post('/chat', async (req, res) => {
  const { messages, token } = req.body;
  const isUnlimited = token && token === FEC_TOKEN;

  // ── Validate messages ───────────────────────────────────────
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required.' });
  }

  for (const msg of messages) {
    if (!msg.role || !msg.content || !['user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid message format.' });
    }
    if (typeof msg.content !== 'string' || msg.content.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message must be under ${MAX_MESSAGE_LENGTH} characters.` });
    }
  }

  if (messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Last message must be from user.' });
  }

  if (messages.length > MAX_CONVERSATION_LENGTH) {
    return res.status(400).json({ error: 'Conversation too long. Please start a new conversation.' });
  }

  // ── Sanitise and check ALL messages for injection ───────────
  // FIX [High]: Check every message in the conversation, not just the last one.
  // Also sanitise all user messages, not just the last.
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user') {
      msg.content = sanitiseInput(msg.content);
      if (!msg.content) {
        return res.status(400).json({ error: 'Empty message.' });
      }
    }
    // Check injection in ALL messages (user and assistant, since assistant messages are client-supplied)
    if (checkPromptInjection(msg.content)) {
      console.warn(`[BLOCKED] Prompt injection in ${msg.role} message ${i}: "${msg.content.substring(0, 100)}"`);
      return res.status(400).json({
        error: "I can't process that request. Try rephrasing your question about fractional work."
      });
    }
  }

  // ── Check API key ───────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'ZacBot is temporarily unavailable. Please try again later.' });
  }

  // ── Rate limiting (per IP) ──────────────────────────────────
  const clientIP = getClientIP(req);
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  // ── Daily cap ───────────────────────────────────────────────
  if (!checkDailyCap()) {
    return res.status(503).json({
      error: 'ZacBot has reached its daily limit. Please try again tomorrow.'
    });
  }

  // ── Log question ────────────────────────────────────────────
  const lastUserMessage = messages[messages.length - 1].content;
  logQuestion(lastUserMessage, clientIP, isUnlimited);

  // ── Stream response ─────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.flushHeaders();

  let aborted = false;

  req.on('close', () => { aborted = true; });

  // Use SDK .stream() method - same pattern as working LinkedIn Analyzer
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log('[STREAM] Starting Anthropic API call...');

  const stream = client.messages.stream({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: messages.map(m => ({ role: m.role, content: m.content }))
  });

  let chunkCount = 0;

  stream.on('message', (msg) => {
    console.log('[STREAM] Message event:', msg.type, msg.stop_reason || '');
  });

  stream.on('text', (text) => {
    if (!aborted) {
      chunkCount++;
      if (chunkCount <= 3) console.log(`[STREAM] Chunk ${chunkCount}: "${text.substring(0, 50)}"`);
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
    }
  });

  stream.on('error', (error) => {
    if (aborted) return;
    console.error('[STREAM] Error:', error.status, error.message || error);
    const msg = error.status === 429
      ? 'ZacBot is busy right now. Please try again in a minute.'
      : 'ZacBot is temporarily unavailable. Please try again later.';
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
      res.end();
    } catch (e) { /* already closed */ }
  });

  stream.on('end', () => {
    console.log(`[STREAM] Complete. ${chunkCount} chunks sent.`);
    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
      res.end();
    }
  });

  req.on('close', () => {
    aborted = true;
    try { stream.abort(); } catch (e) { /* ignore */ }
  });
});

// ── Error handling ────────────────────────────────────────────
process.on('unhandledRejection', (err) => {
  if (err.name === 'AbortError' || err.name === 'APIUserAbortError' || err.message?.includes('aborted')) return;
  console.error('Unhandled rejection:', err);
});

app.listen(PORT, () => {
  console.log(`ZacBot API running on port ${PORT}`);
  console.log(`  Daily request cap: ${DAILY_REQUEST_CAP}`);
  console.log(`  Rate limit: ${RATE_LIMIT_PER_MIN} req/min per IP`);
  console.log(`  Max message length: ${MAX_MESSAGE_LENGTH} chars`);
  console.log(`  FEC_TOKEN: set`);
  console.log(`  ADMIN_TOKEN: ${process.env.ADMIN_TOKEN ? 'separate' : 'same as FEC_TOKEN'}`);
});
