# ZacBot API

AI chat assistant for the Fractional Exec Community, powered by Claude API.

## Local Development

```bash
cd zacbot-api
npm install
ANTHROPIC_API_KEY=your-key-here FEC_TOKEN=your-token-here node server.js
```

Server runs on port 3001 (or `PORT` env var).

To test the full setup, also serve the static site:
```bash
cd ..  # FEC-website-2026 root
python3 -m http.server 8888
```

Then open `http://localhost:8888/zacbot.html`

## Deploy to Railway

1. Go to Railway dashboard (railway.app)
2. New Project > Deploy from local directory (or connect GitHub repo)
3. Point to the `zacbot-api/` directory
4. Set environment variables:
   - `ANTHROPIC_API_KEY` - your Anthropic API key
   - `PORT` - Railway sets this automatically, don't override
5. Railway auto-detects Node.js, runs `npm start` which calls `node server.js`
6. Note the generated URL (e.g. `zacbot-api-production-xxxx.up.railway.app`)

### After Railway deploy

API_URL is already set in `js/zacbot.js` pointing to the Railway production URL.
Push the website changes to trigger Netlify deploy.

## Deploy website changes to Netlify

The FEC website auto-deploys from GitHub on push:
```bash
cd FEC-website-2026
git add -A
git commit -m "Replace Delphi with ZacBot"
git push
```

## Update Mighty Networks link

Post this URL in Mighty Networks for FEC members:
```
https://thefractionalexec.com.au/zacbot?token=<your-FEC-token>
```

The token gives unlimited access. Without it, visitors get 3 free questions.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check |
| POST | `/chat` | Chat endpoint (SSE streaming) |
| POST | `/auth` | Token validation (rate limited, 5 attempts/hr per IP) |
| POST | `/lead` | Email capture from trial gate |
| POST | `/feedback` | Thumbs up/down on responses |
| GET | `/questions?token=...` | View questions, leads, feedback (protected) |
| POST | `/api/find` | Fractional Finder search |
| GET | `/api/directory/meta` | Public directory filter metadata |
| POST | `/api/directory/sync?token=...` | Admin-only Notion snapshot sync |

### POST /chat

```json
{
  "messages": [
    { "role": "user", "content": "How should I price my fractional services?" }
  ]
}
```

Returns Server-Sent Events stream:
- `data: {"type":"chunk","text":"..."}` - text chunks
- `data: {"type":"done"}` - stream complete
- `data: {"type":"error","error":"..."}` - error message

## Configuration

| Env Var | Required | Description |
|---------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `FEC_TOKEN` | **Yes** | FEC member access token (no default, must be set) |
| `ADMIN_TOKEN` | **Yes** | Separate token for /questions dashboard (must be different from FEC_TOKEN) |
| `DAILY_REQUEST_CAP` | No | Max requests per day (default: 500) |
| `SLACK_BOT_TOKEN` | No | Slack incoming webhook for daily summary (6pm AEST) |
| `PORT` | No | Server port (default 3001, Railway sets automatically) |
| `NOTION_TOKEN` | Phase 1 sync | Dedicated Notion integration token scoped to FEC Applications DB |
| `NOTION_DATABASE_ID` | No | FEC Applications DB ID (defaults to PRD value) |
| `DIRECTORY_SNAPSHOT_GZIP_BASE64_1..4` | Railway fallback | Ordered chunks of a compressed directory snapshot when direct Notion sync is unavailable |
| `FINDER_PUBLIC_ENABLED` | No | Set `true` only after the public consent window |
| `FINDER_PUBLIC_CHAT_ENABLED` | No | Set `true` to let public ZacBot chats call the finder |
| `PUBLIC_DIRECTORY_SEARCHES_PER_HOUR` | No | Public search rate limit (default: 10/IP/hr) |
| `MEMBER_DIRECTORY_SEARCHES_PER_HOUR` | No | Member search rate limit (default: 30/IP/hr) |

## Fractional Finder

The finder reads a local snapshot at `data/members.json`; this directory is gitignored because it contains member profile data. Sync it from Notion with:

```bash
curl -X POST "https://YOUR-RAILWAY-URL/api/directory/sync?token=$ADMIN_TOKEN"
```

Snapshot rules:
- Only Notion `Status = Active` records are included.
- `Directory = Opted out`, test records, and records missing both LinkedIn and bio are excluded.
- Email is never written to the snapshot and never returned by `/api/find`.
- Blurbs are sanitized at sync time and cached by bio hash in `data/blurbs.json`.

Phase flags:
- Phase 1 member mode works with the existing ZacBot `token`/`FEC_TOKEN`.
- Phase 2 public `/find` requires `FINDER_PUBLIC_ENABLED=true`.
- Public finder intent inside ZacBot chat additionally requires `FINDER_PUBLIC_CHAT_ENABLED=true`.

### Hardcoded config (in code)

| Setting | Location | Current Value |
|---------|----------|---------------|
| Trial question limit | `js/zacbot.js` | 3 |
| API URL | `js/zacbot.js` | Railway production URL |
| Rate limit | `server.js` | 10 req/min per IP |
| Max tokens per response | `server.js` | 1000 |
| Model | `server.js` | `claude-haiku-4-5-20251001` |
| CORS origins | `server.js` | thefractionalexec.com.au + localhost |

**Note:** FEC_TOKEN and ADMIN_TOKEN are env vars only. They are NOT in any source files.

## Knowledge Base

Content files in `knowledge/` directory. To update:

1. Edit/add/remove .md files in `knowledge/`
2. Redeploy to Railway (push or `railway up`)
3. Server reloads knowledge base on startup

Current size: ~38k tokens (~150k chars)

### File structure

```
knowledge/
  business-os-guide.md       # The 10k guide (core)
  voice-and-persona.md       # ZacBot personality
  fec-overview.md            # FEC value prop
  workshops/                 # 3 workshop materials
  templates/                 # 6 CLAUDE.md templates
  content/                   # 11 LinkedIn posts + articles
```

## Cost

- Railway: $5/month (starter plan)
- Claude API (Haiku): ~$5-15/month at expected usage
- Total: ~$10-20/month (vs $95/month Delphi)

## Rotating the FEC token

If the unlimited access URL leaks:

1. Change `FEC_TOKEN` env var in Railway (redeploys automatically)
2. Update the link in Mighty Networks with the new token
