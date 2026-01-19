const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['https://thefractionalexec.com.au', 'http://localhost:8888', 'http://127.0.0.1:8888'],
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));

// Rate limiting store (in-memory - resets on deploy)
const rateLimitStore = new Map();

const SYSTEM_PROMPT = `You are an expert LinkedIn profile optimisation specialist for fractional executives.

Analyse the profile and return a JSON response with this exact structure:

{
  "executiveSummary": {
    "score": 75,
    "verdict": "One sentence overall assessment",
    "topStrength": "Their biggest strength",
    "criticalGap": "The most important thing to fix"
  },
  "headline": {
    "current": "Their current headline",
    "issues": ["Issue 1", "Issue 2"],
    "alternatives": ["Alternative 1", "Alternative 2", "Alternative 3"]
  },
  "about": {
    "strengths": ["Strength 1", "Strength 2"],
    "improvements": ["Improvement 1", "Improvement 2"],
    "rewrite": "A rewritten about section optimised for fractional positioning (2-3 paragraphs)"
  },
  "actions": [
    {"priority": 1, "action": "Action to take", "impact": "High", "why": "Brief reason"},
    {"priority": 2, "action": "Second action", "impact": "High", "why": "Brief reason"},
    {"priority": 3, "action": "Third action", "impact": "Medium", "why": "Brief reason"}
  ]
}

Scoring: 90-100 excellent, 75-89 good, 60-74 average, below 60 needs work.
Focus on fractional executive positioning, clear value proposition, and attracting inbound leads.

IMPORTANT: Return ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'LinkedIn Analyser API' });
});

// Main analyse endpoint with streaming
app.post('/analyse', async (req, res) => {
  const { pdf, screenshot, email, turnstileToken } = req.body;

  // Validate PDF
  if (!pdf) {
    return res.status(400).json({ error: 'PDF export is required.' });
  }

  // Check API keys
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'API not configured.' });
  }

  if (!process.env.TURNSTILE_SECRET_KEY) {
    console.error('TURNSTILE_SECRET_KEY not set');
    return res.status(500).json({ error: 'Security not configured.' });
  }

  // Verify Turnstile
  if (!turnstileToken) {
    return res.status(400).json({ error: 'Please complete verification.' });
  }

  try {
    const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: req.headers['x-forwarded-for']?.split(',')[0] || req.ip || ''
      })
    });
    const turnstileResult = await turnstileRes.json();

    if (!turnstileResult.success) {
      console.error('Turnstile failed:', turnstileResult);
      return res.status(403).json({ error: 'Verification failed. Please refresh and try again.' });
    }
  } catch (err) {
    console.error('Turnstile error:', err);
    return res.status(500).json({ error: 'Verification service error.' });
  }

  // Rate limiting
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 5;

  let entry = rateLimitStore.get(clientIP) || { count: 0, start: now };
  if (now - entry.start > windowMs) {
    entry = { count: 0, start: now };
  }
  entry.count += 1;
  rateLimitStore.set(clientIP, entry);

  if (entry.count > maxRequests) {
    return res.status(429).json({ error: 'Too many requests. Please wait 15 minutes.' });
  }

  // Set up SSE headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.flushHeaders();

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Build content array
    const content = [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdf }
      }
    ];

    if (screenshot) {
      let mediaType = 'image/png';
      if (screenshot.startsWith('/9j/')) mediaType = 'image/jpeg';
      else if (screenshot.startsWith('UklGR')) mediaType = 'image/webp';

      content.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: screenshot }
      });
    }

    content.push({
      type: 'text',
      text: 'Analyse this LinkedIn profile for a fractional executive. Return JSON only.'
    });

    // Stream the response
    let fullText = '';

    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }]
    });

    stream.on('text', (text) => {
      fullText += text;
      // Send chunk to client
      res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
    });

    stream.on('error', (error) => {
      console.error('Stream error:', error);
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Analysis failed.' })}\n\n`);
      res.end();
    });

    stream.on('end', () => {
      // Parse final JSON
      try {
        const jsonMatch = fullText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          res.write(`data: ${JSON.stringify({ type: 'complete', analysis })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to parse response.' })}\n\n`);
        }
      } catch (parseErr) {
        console.error('Parse error:', parseErr);
        res.write(`data: ${JSON.stringify({ type: 'error', error: 'Failed to parse response.' })}\n\n`);
      }

      // Log email if provided
      if (email) {
        console.log('Email captured:', email);
      }

      res.end();
    });

  } catch (error) {
    console.error('Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Analysis failed. Please try again.' })}\n\n`);
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`LinkedIn Analyser API running on port ${PORT}`);
});
