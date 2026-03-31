# Job Tracker Agent

An agentic AI workflow that evaluates job descriptions against your profile, logs results to Notion, and drafts outreach emails in Gmail. Runs as a single React component inside [Claude Artifacts](https://support.anthropic.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them).

![Job Tracker Agent demo](screenshot.png)

## Try it yourself (5 minutes)

You need a [Claude.ai](https://claude.ai) account (free or Pro).

### Step 1: Connect your tools

Go to **Settings > Connected Apps** in Claude and connect:
- **Notion** (the agent creates a job tracker database and logs roles there)
- **Gmail** (the agent saves outreach email drafts here)

Both are optional. The agent skips whichever isn't connected and keeps going.

### Step 2: Create the artifact

Start a new conversation in Claude and send this message:

> Create a React artifact with the following code:

Then paste the entire contents of [`job-tracker-agent.jsx`](./job-tracker-agent.jsx) after that message.

### Step 3: Add your profile

Before running the agent, edit two things at the top of the artifact code:

1. **`PROFILE_CONTEXT`** - Replace the placeholder with your actual background. Keep it to 5-8 lines:

```
Jane Smith - Senior PM (~6 years)
Roles: PM at Stripe (payments platform, 3 years), PM at Figma (collaboration features, 2 years), APM at Google (1 year).
Skills: SQL, Python, Figma, A/B testing, PRDs, growth experimentation.
Education: BS Computer Science, Stanford.
Location: San Francisco (open to remote).
Target: Senior PM or Group PM roles in fintech or developer tools.
```

2. **`SENDER_NAME`** - Change `"Your Name"` to your actual name.

### Step 4: Run it

1. Open any job listing in your browser (Greenhouse, Lever, Ashby, LinkedIn, wherever)
2. Copy the job description text from the page
3. Paste it into the textarea in the artifact
4. Click **Run Agent**

The pipeline runs in about 30-60 seconds:

```
Parse JD → Evaluate Fit → Log to Notion → Draft Email → Done
```

You'll see a fit score, strengths/gaps breakdown, and a ready-to-send outreach email. If Notion is connected, check your workspace for a new "Job Tracker" database with the entry logged.

## What it does

| Step | What happens | Model |
|------|-------------|-------|
| Parse JD | Reads pasted text (or fetches from URL) | Instant / Haiku |
| Evaluate fit | Scores role 0-100 against your profile | Haiku 4.5 |
| Log to Notion | Creates database + adds row via MCP | Sonnet 4 |
| Draft email | Writes cold outreach + saves Gmail draft | Haiku 4.5 + Sonnet 4 |

MCP steps have 30-second timeouts. If Notion or Gmail is slow or disconnected, the agent moves on and still shows all results in the UI.

## Architecture

```
User pastes JD
    │
    ▼
[Parse]          instant (no API call for pasted text)
    │
    ▼
[Evaluate Fit]   Claude Haiku 4.5 → structured JSON
    │
    ▼
[Log to Notion]  Claude Sonnet 4 + Notion MCP (30s timeout)
    │
    ▼
[Draft Email]    Claude Haiku 4.5 → structured JSON
    │
    ▼
[Save to Gmail]  Claude Sonnet 4 + Gmail MCP (30s timeout)
```

## Customization

All configuration lives at the top of `job-tracker-agent.jsx`:

- `PROFILE_CONTEXT` - Your professional background
- `SENDER_NAME` - Name for email sign-off
- `SYSTEM_PROMPT_FIT` - Evaluation criteria and JSON schema
- `SYSTEM_PROMPT_EMAIL` - Email style, structure, and tone

See [`config.example.js`](./config.example.js) for a profile template.

## Adapting for standalone use

This runs inside Claude Artifacts with zero setup. To run it outside Claude:

1. Set up a React project (Vite, Next.js, etc.)
2. Copy `job-tracker-agent.jsx` into your project
3. Add auth headers to the `callClaude()` function:
   ```js
   headers: {
     "Content-Type": "application/json",
     "x-api-key": process.env.ANTHROPIC_API_KEY,
     "anthropic-version": "2023-06-01"
   }
   ```
4. Replace Notion/Gmail MCP calls with direct API integrations
5. See [`.env.example`](./.env.example) for environment variables

## File structure

```
job-tracker-agent/
├── job-tracker-agent.jsx   # Main component (paste into Claude Artifact)
├── config.example.js       # Profile context template
├── .env.example            # API key placeholder (standalone only)
├── .gitignore
├── LICENSE
└── README.md
```

## Tech stack

- React (single-file, no build step inside Claude Artifacts)
- [Claude API](https://docs.anthropic.com/en/api/messages) (`/v1/messages`)
- [Notion MCP](https://www.notion.so/) for database operations
- [Gmail MCP](https://gmail.mcp.claude.com) for draft creation
- IBM Plex Mono + IBM Plex Sans

## License

MIT
