const express = require('express');
const cors = require('cors');
const dns = require('node:dns');
const { loadKnowledgeBase } = require('./lib/knowledge');
const { directory, DirectoryUnavailableError } = require('./lib/directory');

const app = express();
const PORT = process.env.PORT || 3001;

// Railway doesn't support outbound IPv6. Prefer IPv4 when resolving API hosts.
dns.setDefaultResultOrder('ipv4first');

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
const PUBLIC_DIRECTORY_SEARCHES_PER_HOUR = parseInt(process.env.PUBLIC_DIRECTORY_SEARCHES_PER_HOUR, 10) || 10;
const MEMBER_DIRECTORY_SEARCHES_PER_HOUR = parseInt(process.env.MEMBER_DIRECTORY_SEARCHES_PER_HOUR, 10) || 30;
const FINDER_PUBLIC_ENABLED = process.env.FINDER_PUBLIC_ENABLED === 'true';
const FINDER_PUBLIC_CHAT_ENABLED = process.env.FINDER_PUBLIC_CHAT_ENABLED === 'true';
const DIRECTORY_SYNC_INTERVAL_MS = Math.max(
  60000,
  parseInt(process.env.DIRECTORY_SYNC_INTERVAL_MS, 10) || 24 * 60 * 60 * 1000
);
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

// ── Directory Search Rate Limiting (per IP, per hour) ─────────
const directoryRateLimitStore = new Map();

function checkDirectoryRateLimit(ip, isMember) {
  const now = Date.now();
  const key = `${isMember ? 'member' : 'public'}:${ip}`;
  let entry = directoryRateLimitStore.get(key) || { count: 0, start: now };
  if (now - entry.start > 3600000) {
    entry = { count: 0, start: now };
  }
  entry.count += 1;
  directoryRateLimitStore.set(key, entry);
  return entry.count <= (isMember ? MEMBER_DIRECTORY_SEARCHES_PER_HOUR : PUBLIC_DIRECTORY_SEARCHES_PER_HOUR);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of directoryRateLimitStore) {
    if (now - entry.start > 7200000) directoryRateLimitStore.delete(key);
  }
}, 1800000);

// ── Daily Request Cap ─────────────────────────────────────────
let dailyRequestCount = 0;
let dailyResetDate = new Date().toDateString();
let alertSent = false;

// Weekly counters (reset after weekly Slack summary fires)
let weeklyRequestCount = 0;
let weekStart = new Date().toISOString();

function checkDailyCap() {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyRequestCount = 0;
    dailyResetDate = today;
    alertSent = false;
    console.log('[DAILY] Counter reset for new day');
  }
  dailyRequestCount++;
  weeklyRequestCount++;

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

function slackDirectoryError(message) {
  sendSlack(`*[Directory]* ${message}`);
}

directory.configure({ sendSlack });

async function refreshDirectoryFromNotion(reason) {
  try {
    const synced = await directory.sync();
    console.log(`[DIRECTORY] ${reason} sync complete: ${synced.memberCount} members`);
  } catch (err) {
    console.error(`[DIRECTORY] ${reason} sync failed:`, err.message);
    slackDirectoryError(`${reason} sync failed: ${err.message}`);
  }
}

directory.loadSnapshot()
  .then(async (snapshot) => {
    if (snapshot) {
      console.log(`[DIRECTORY] Loaded ${snapshot.memberCount || 0} members from snapshot`);
    } else {
      console.warn('[DIRECTORY] No snapshot found');
    }

    if (process.env.NOTION_TOKEN) {
      await refreshDirectoryFromNotion('Boot');
    } else {
      console.warn('[DIRECTORY] NOTION_TOKEN is not set; serving the fallback snapshot only');
    }
  })
  .catch((err) => {
    console.error('[DIRECTORY] Failed to load snapshot:', err.message);
    slackDirectoryError(`Snapshot load failed: ${err.message}`);
  });

if (process.env.NOTION_TOKEN) {
  const directorySyncTimer = setInterval(
    () => refreshDirectoryFromNotion('Scheduled'),
    DIRECTORY_SYNC_INTERVAL_MS
  );
  directorySyncTimer.unref();
}

async function sendWeeklySlackSummary() {
  const weekStartMs = new Date(weekStart).getTime();
  const inWindow = (ts) => new Date(ts).getTime() >= weekStartMs;

  const weekQuestions = questionLog.filter(q => inWindow(q.timestamp)).map(q => q.question).slice(-10);
  const weekFeedback = feedbackLog.filter(f => inWindow(f.timestamp));
  const thumbsUp = weekFeedback.filter(f => f.vote === 'up').length;
  const thumbsDown = weekFeedback.filter(f => f.vote === 'down').length;
  const weekLeads = leadLog.filter(l => inWindow(l.timestamp));

  const text = [
    `*ZacBot Weekly Summary (${new Date().toLocaleDateString('en-AU')})*`,
    `Requests this week: ${weeklyRequestCount}`,
    `Leads: ${weekLeads.length}${weekLeads.length > 0 ? ' (' + weekLeads.map(l => l.email).join(', ') + ')' : ''}`,
    `Feedback: ${thumbsUp} up, ${thumbsDown} down`,
    weekQuestions.length > 0 ? `\n*Recent questions:*\n${weekQuestions.map((q, i) => `${i + 1}. ${q.substring(0, 100)}`).join('\n')}` : ''
  ].join('\n');

  await sendSlack(text);
  console.log('[SLACK] Weekly summary sent');

  // Reset weekly counters
  weeklyRequestCount = 0;
  weekStart = new Date().toISOString();
}

// Weekly: Mondays 6pm AEST (8:00 UTC). Guard against double-fire within a week.
let lastWeeklySummaryDate = null;
setInterval(() => {
  const now = new Date();
  const today = now.toDateString();
  if (
    now.getUTCDay() === 1 &&
    now.getUTCHours() === 8 &&
    now.getUTCMinutes() < 5 &&
    lastWeeklySummaryDate !== today
  ) {
    lastWeeklySummaryDate = today;
    sendWeeklySlackSummary();
  }
}, 300000);

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

app.get('/api/directory/meta', async (req, res) => {
  try {
    const meta = await directory.getMeta();
    res.json(meta);
  } catch (err) {
    if (err instanceof DirectoryUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[DIRECTORY] Meta failed:', err.message);
    res.status(500).json({ error: 'Directory is temporarily unavailable.' });
  }
});

app.post('/api/directory/sync', async (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const snapshot = await directory.sync();
    res.json({
      ok: true,
      syncedAt: snapshot.syncedAt,
      memberCount: snapshot.memberCount,
      excluded: snapshot.excluded
    });
  } catch (err) {
    console.error('[DIRECTORY] Sync failed:', err.message);
    slackDirectoryError(`Sync failed: ${err.message}`);
    res.status(500).json({ error: 'Directory sync failed. Previous snapshot is still being served if available.' });
  }
});

app.post('/api/find', async (req, res) => {
  const clientIP = getClientIP(req);
  const { query, token } = req.body || {};
  const isMember = token && token === FEC_TOKEN;

  if (!isMember && !FINDER_PUBLIC_ENABLED) {
    return res.status(403).json({ error: 'Directory search is currently available to FEC members only.' });
  }

  if (!query || typeof query !== 'string' || query.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Query must be under ${MAX_MESSAGE_LENGTH} characters.` });
  }

  const cleanQuery = sanitiseInput(query);
  if (!cleanQuery) {
    return res.status(400).json({ error: 'Empty query.' });
  }

  if (checkPromptInjection(cleanQuery)) {
    console.warn(`[BLOCKED] Prompt injection in directory query: "${cleanQuery.substring(0, 100)}"`);
    return res.status(400).json({
      error: "I can't process that request. Try rephrasing your search."
    });
  }

  if (!checkDirectoryRateLimit(clientIP, isMember)) {
    return res.status(429).json({ error: 'Too many searches - try again in an hour or log in as a member.' });
  }

  if (!checkDailyCap()) {
    return res.status(503).json({ error: 'ZacBot has reached its daily limit. Please try again tomorrow.' });
  }

  logQuestion(`[finder] ${cleanQuery}`, clientIP, isMember);

  try {
    const result = await directory.search(cleanQuery);
    res.json(result);
  } catch (err) {
    if (err instanceof DirectoryUnavailableError) {
      return res.status(503).json({ error: err.message });
    }
    console.error('[DIRECTORY] Search failed:', err.message);
    res.status(500).json({ error: 'Directory search is temporarily unavailable.' });
  }
});

function isFinderIntent(text) {
  return /\b(find|looking for|need|recommend|know)\b.{0,80}\b(fractional|cmo|cfo|coo|cto|cro|vp sales|operator|exec|executive)\b/i.test(text);
}

function writeSseHeaders(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.flushHeaders();
}

function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

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

  const clientIP = getClientIP(req);
  const lastUserMessage = messages[messages.length - 1].content;

  if (isFinderIntent(lastUserMessage) && (isUnlimited || FINDER_PUBLIC_CHAT_ENABLED)) {
    if (!checkDirectoryRateLimit(clientIP, isUnlimited)) {
      return res.status(429).json({ error: 'Too many searches - try again in an hour or log in as a member.' });
    }

    if (!checkDailyCap()) {
      return res.status(503).json({
        error: 'ZacBot has reached its daily limit. Please try again tomorrow.'
      });
    }

    logQuestion(`[finder-chat] ${lastUserMessage}`, clientIP, isUnlimited);
    writeSseHeaders(req, res);

    try {
      const result = await directory.search(lastUserMessage);
      if (result.clarifyingQuestion) {
        writeSseEvent(res, { type: 'chunk', text: result.clarifyingQuestion });
      } else {
        writeSseEvent(res, {
          type: 'directory',
          count: result.count,
          totalCount: result.totalCount,
          shownCount: result.shownCount,
          cards: result.cards,
          suggestion: result.suggestion,
          broaderCount: result.broaderCount,
          broaderSuggestion: result.broaderSuggestion,
          degraded: result.degraded
        });
      }
      writeSseEvent(res, { type: 'done' });
      res.end();
      return;
    } catch (err) {
      const message = err instanceof DirectoryUnavailableError
        ? err.message
        : 'Directory search is temporarily unavailable.';
      if (!(err instanceof DirectoryUnavailableError)) {
        console.error('[DIRECTORY] Chat search failed:', err.message);
      }
      writeSseEvent(res, { type: 'error', error: message });
      res.end();
      return;
    }
  }

  // ── Check API key ───────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'ZacBot is temporarily unavailable. Please try again later.' });
  }

  // ── Rate limiting (per IP) ──────────────────────────────────
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
  logQuestion(lastUserMessage, clientIP, isUnlimited);

  // ── Stream response ─────────────────────────────────────────
  writeSseHeaders(req, res);

  let aborted = false;
  let timedOut = false;
  const upstreamAbortController = new AbortController();
  const upstreamTimeout = setTimeout(() => {
    timedOut = true;
    console.error('[STREAM] Anthropic request timed out after 65s');
    upstreamAbortController.abort();
  }, 65000);

  // Important: req.close fires as soon as Express finishes reading the POST body.
  // For SSE cancellation we need the response-side close event instead.
  res.on('close', () => {
    clearTimeout(upstreamTimeout);
    if (!res.writableEnded) {
      aborted = true;
      upstreamAbortController.abort();
    }
  });

  req.on('aborted', () => {
    clearTimeout(upstreamTimeout);
    aborted = true;
    upstreamAbortController.abort();
  });

  (async () => {
    try {
      const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        signal: upstreamAbortController.signal,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          stream: true,
          system: SYSTEM_PROMPT,
          messages: messages.map(m => ({ role: m.role, content: m.content }))
        })
      });

      if (!anthropicRes.ok) {
        const errText = await anthropicRes.text();
        console.error('[STREAM] API error:', anthropicRes.status, errText.substring(0, 200));
        const errMsg = anthropicRes.status === 429
          ? 'ZacBot is busy right now. Please try again in a minute.'
          : 'ZacBot is temporarily unavailable. Please try again later.';
        res.write(`data: ${JSON.stringify({ type: 'error', error: errMsg })}\n\n`);
        res.end();
        return;
      }

      let buffer = '';

      for await (const rawChunk of anthropicRes.body) {
        if (aborted) break;

        buffer += typeof rawChunk === 'string' ? rawChunk : new TextDecoder().decode(rawChunk);
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;

          try {
            const event = JSON.parse(data);
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: event.delta.text })}\n\n`);
            }
          } catch (e) { /* skip parse errors */ }
        }
      }

      if (!aborted) {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
      }

    } catch (error) {
      clearTimeout(upstreamTimeout);

      if (aborted && !timedOut) return;

      console.error('[STREAM] Fetch error:', error.message || error);
      try {
        const errorMessage = timedOut
          ? 'ZacBot is taking too long to respond right now. Please try again in a minute.'
          : 'ZacBot is temporarily unavailable.';
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
          res.end();
        }
      } catch (e) { /* already closed */ }
    } finally {
      clearTimeout(upstreamTimeout);
    }
  })();
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
