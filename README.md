# Parent Coach

A small Next.js app where a parent types a concern in **English or Urdu** and gets a brief, supportive coaching reply. The coach is **shape-aware**: every turn it decides whether a natural conversational reply is enough, whether the parent needs a short structured plan, or whether the message is a safety escalation.

Conversations are stored in MongoDB so history and context survive a page reload. No login required.

## What it does

- **Bilingual input** — English, Urdu script, or Roman Urdu. The coach replies in the language/script the parent used.
- **A decision layer per message** — the reply shape is dynamic, not fixed:
  - `chat` — a natural, human reply (1–3 sentences). Used for greetings, thanks, venting, clarifying questions, or a quick back-and-forth. No headings, no forced lists, no plan framing.
  - `plan` — a brief structured plan: one-line concern summary, 2–4 concrete steps, and a follow-up check-in. Used when the parent describes a real parenting problem and wants something actionable.
  - `safety` — a hard escalation: supportive text, an explicit emergency/safety note (contact local emergency services such as 112/911 or a trusted crisis/child-protection service), 3 urgent safe steps, and a check-in.
- **Crisis detection is layered** — a regex heuristic runs first (English + Roman Urdu), so obvious emergencies escalate instantly without depending on the model. The classifier and generation layers can escalate too, but can never downgrade a heuristic escalation.
- **Context that persists** — beyond raw message history, each conversation keeps a small rolling state (`topic`, `child_age`, `strategies_tried`, `open_question`) that is fed back into the model, so advice is not repeated turn after turn.
- **Safety boundaries** — no diagnosis; no medical, dosing, or legal instructions; clear escalation for emergencies, abuse, or self-harm.

## How the decision layer works

```
user message
   │
   ├─ crisis heuristic ──► safety  (no model call needed)
   │
   ├─ classifier call (cheap, temperature 0)
   │     └─ chat | plan | safety
   │
   └─ generation call (per mode)
         ├─ chat   → natural prose
         ├─ plan   → summary + steps + optional note + check-in
         └─ safety → supportive text + emergency note + urgent steps
```

If the classifier fails, times out, or returns unparsable JSON, a deterministic heuristic picks the mode so the app never breaks. Both calls share one HTTP helper with a timeout, and every failure path returns a safe, mode-appropriate fallback.

## Tech stack

- **Next.js (App Router) + TypeScript + Tailwind CSS v4**
- **MongoDB** for conversation + state persistence
- **OpenCode Go** (OpenAI-compatible) for the classifier and generation calls
  - default base URL: `https://opencode.ai/inference/go/openai/v1`
  - default model: `beam-free` (fast free tier on OpenCode Go)

## Getting started

### 1) Prerequisites

- Node.js 18+ (Node 20+ recommended)
- npm
- A MongoDB connection string
- An OpenCode Go API key

### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# MongoDB (required for history + conversation state)
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
MONGODB_DB=parent_coach

# OpenCode Go (OpenAI-compatible) API
OPENCODE_BASE_URL=https://opencode.ai/inference/go/openai/v1
OPENCODE_API_KEY=your_opencode_go_api_key
OPENCODE_MODEL=beam-free
```

> `.env.local` is gitignored and must never be committed.

### 4) Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5) Production build

```bash
npm run build
npm start
```

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import it in Vercel (project is already linked to the GitHub repo).
3. Add these **Environment Variables** (Production + Preview):
   - `MONGODB_URI`
   - `MONGODB_DB` (e.g. `parent_coach`)
   - `OPENCODE_BASE_URL`
   - `OPENCODE_API_KEY`
   - `OPENCODE_MODEL`
4. Deploy.

> Tip: add secrets with `vercel env add NAME production --value "<value>"` rather than piping a file — piping can introduce a UTF-8 BOM, which breaks HTTP headers downstream.

## API

### `POST /api/chat`

```json
{ "message": "My 6-year-old refuses to do homework every evening.", "sessionId": "optional-uuid" }
```

Response:

```json
{
  "sessionId": "uuid",
  "mode": "chat | plan | safety",
  "reply": {
    "mode": "plan",
    "concern_summary": "A 6-year-old refuses homework every evening.",
    "plan": ["step 1", "step 2"],
    "safety_note": "optional",
    "follow_up": { "question": "How did it go?", "suggested_time": "tomorrow evening" },
    "escalated": false
  },
  "state": { "topic": "homework refusal", "child_age": "6", "strategies_tried": ["..."] },
  "messages": []
}
```

### `GET /api/chat?sessionId=...`

Returns the stored `messages` (assistant messages include the structured `reply` payload so the UI re-renders identically after a reload) and the rolling `state`.

## Project structure

- `src/lib/types.ts` — shared contract: reply modes, `CoachReply`, `ConversationState`, plain-text renderer
- `src/lib/coach.ts` — crisis heuristics, the mode decision layer, per-mode prompts and model calls
- `src/lib/mongodb.ts` — MongoDB client and helpers
- `src/app/api/chat/route.ts` — loads/saves conversations and state, calls the coach
- `src/app/page.tsx` — chat UI: natural bubbles, plan cards, safety cards, session history
- `src/app/globals.css` — design tokens and surface styling

## Safety notes

- For **general, supportive parenting guidance** only — not a substitute for professional medical, psychological, legal, or emergency services.
- The coach never diagnoses and never gives medical or legal instructions.
- Emergency, abuse, or self-harm content triggers a clear escalation with guidance to contact local emergency or crisis/child-protection services immediately (e.g. 112/911).
- Conversations are stored to render history on the page; there is no login, so avoid entering names, addresses, or other identifying details.

## How coding agents were used

Built with DeepSeek Harness agents, using a parallel split for speed:

- **Lead agent** — explored the environment, pinned the API/LLM configuration (OpenCode Go `beam-free`), defined the shared `types.ts` contract, wrote the MongoDB helper and the `/api/chat` route (history + rolling state persistence), then integrated, deployed to Vercel and verified in a real browser.
- **coach-core subagent** — implemented `src/lib/coach.ts`: crisis heuristic, the chat/plan/safety decision layer with classifier + heuristic fallback, per-mode generation, language matching, and conversation-state maintenance.
- **chat-ui subagent** — implemented `src/app/page.tsx` and `globals.css`: the three distinct renderings (natural bubble, plan card, safety card), session hydration, optimistic sending, and accessibility/responsive work.

Verification was done with live API calls and a headless Playwright/Edge run against the deployed production URL (everyday concern, a follow-up turn, and a crisis escalation).
