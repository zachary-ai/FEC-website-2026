# LinkedIn Profile Analyser - Railway API

Backend API for the LinkedIn Profile Analyser tool. Hosted on Railway to avoid Netlify's 30-second serverless function timeout.

## Overview

The LinkedIn Profile Analyser accepts PDF exports of LinkedIn profiles (and optional screenshots), sends them to Claude for analysis, and returns actionable recommendations for fractional executives.

**Live URL:** https://thefractionalexec.com.au/linkedin-analyser.html
**API Endpoint:** https://fec-website-2026-production.up.railway.app/analyse

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│   Frontend          │     │   Railway API       │     │   Claude API    │
│   (Netlify)         │────▶│   (Express + SSE)   │────▶│   (Haiku 3.5)   │
│   linkedin-         │◀────│   server.js         │◀────│                 │
│   analyser.html     │ SSE │                     │     │                 │
└─────────────────────┘     └─────────────────────┘     └─────────────────┘
```

**Why Railway instead of Netlify Functions:**
- Netlify serverless functions have a hard 30-second timeout
- PDF analysis with Claude often exceeds this limit
- Railway has no timeout limits for long-running requests
- Enables streaming responses for better UX

## Features

- **Streaming responses (SSE):** Users see analysis appear in real-time
- **Turnstile verification:** Cloudflare bot protection
- **Rate limiting:** 5 requests per 15 minutes per IP
- **PDF + Screenshot analysis:** Accepts both for comprehensive review

## Files

```
railway-api/
├── server.js      # Express server with streaming Claude API
├── package.json   # Dependencies
└── README.md      # This file

Frontend (in parent directory):
├── linkedin-analyser.html   # Tool UI with streaming display
```

## Environment Variables (Railway)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key |
| `PORT` | Auto-set by Railway (defaults to 8080) |

## API Endpoint

### POST /analyse

Accepts a LinkedIn profile PDF and optional screenshot, returns streaming analysis.

**Request body:**
```json
{
  "pdf": "base64-encoded-pdf",
  "screenshot": "base64-encoded-image (optional)",
  "email": "user@example.com (optional)",
  "turnstileToken": "cloudflare-turnstile-token"
}
```

**Response (Server-Sent Events):**
```
data: {"type":"chunk","text":"..."}
data: {"type":"chunk","text":"..."}
data: {"type":"complete","analysis":{...}}
```

**Analysis JSON structure:**
```json
{
  "executiveSummary": {
    "score": 75,
    "verdict": "Overall assessment",
    "topStrength": "Biggest strength",
    "criticalGap": "Most important fix"
  },
  "headline": {
    "current": "Their headline",
    "issues": ["Issue 1", "Issue 2"],
    "alternatives": ["Alt 1", "Alt 2", "Alt 3"]
  },
  "about": {
    "strengths": ["Strength 1"],
    "improvements": ["Improvement 1"],
    "rewrite": "Rewritten about section"
  },
  "actions": [
    {"priority": 1, "action": "...", "impact": "High", "why": "..."}
  ]
}
```

## Model Selection

Currently using **Claude 3.5 Haiku** for cost efficiency.

| Model | Cost per analysis | Notes |
|-------|-------------------|-------|
| Haiku 3.5 | ~$0.004 | Current - good quality, lowest cost |
| Sonnet 4 | ~$0.05 | 12x more expensive, slightly better |
| Opus 4 | ~$0.26 | Overkill for this use case |

To switch models, edit `server.js` line 157:
```javascript
model: 'claude-3-5-haiku-20241022',  // or 'claude-sonnet-4-20250514'
```

## Deployment

Railway auto-deploys from the GitHub repo on push to main.

**Manual deployment:**
1. Push changes to GitHub
2. Railway detects and rebuilds automatically
3. Check deployment logs in Railway dashboard

**First-time setup:**
1. Create new project in Railway
2. Connect GitHub repo
3. Set environment variables (ANTHROPIC_API_KEY, TURNSTILE_SECRET_KEY)
4. Generate public domain (Settings → Networking → Generate Domain)
5. Ensure port matches (Railway uses PORT env var, defaults to 8080)

## Rate Limiting

- 5 requests per 15 minutes per IP address
- In-memory store (resets on deploy)
- Returns 429 status when exceeded

## CORS

Allowed origins:
- `https://thefractionalexec.com.au`
- `http://localhost:8888`
- `http://127.0.0.1:8888`

## Troubleshooting

**502 errors:**
- Check Railway logs for startup errors
- Verify environment variables are set correctly
- Ensure port configuration matches (regenerate domain if needed)

**"Security not configured" error:**
- TURNSTILE_SECRET_KEY not set or has invalid characters
- Delete and re-enter the variable in Railway dashboard

**Streaming not working:**
- Check browser console for SSE connection errors
- Verify CORS headers are correct for your domain

## Cost Monitoring

At current Haiku pricing (~$0.004/analysis):
- 100 analyses/month = ~$0.40
- 1,000 analyses/month = ~$4
- 10,000 analyses/month = ~$40

Monitor usage in Anthropic dashboard: https://console.anthropic.com

## Related Files

- **Frontend:** `/linkedin-analyser.html`
- **Legacy Netlify function:** `/netlify/functions/analyse-linkedin.js` (deprecated)
- **Tools landing page:** `/tools.html`

## Changelog

**2026-01-20:**
- Migrated from Netlify Functions to Railway
- Added SSE streaming for real-time response display
- Switched from Sonnet 4 to Haiku 3.5 for cost savings
- Added ZacBot CTA in results section
- Fixed dark theme styling for result cards
