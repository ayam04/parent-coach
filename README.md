# Parent Coach

A small Next.js app where a parent can type a concern in **English or Urdu** and receive a brief, structured, and supportive coaching response with a follow-up check-in. Conversations are stored in MongoDB so history can be shown on the page (no login required).

## What it does

- **Bilingual input:** parents can write concerns in English or Urdu.
- **Structured, brief replies:** each coach response includes:
  - a short concern summary,
  - a clear safety note,
  - 2–4 practical steps,
  - a caring follow-up check-in (question and/or suggested time).
- **Conversation history:** messages are persisted per session and shown in the chat UI.
- **Safety-first behavior:**
  - does **not** diagnose,
  - does **not** provide medical or legal instructions,
  - clearly **escalates** if the message describes an emergency, abuse, or self-harm, urging immediate contact with local emergency/crisis/child protection services (e.g. 112/911) while staying supportive.

## Tech stack

- **Next.js (App Router) + TypeScript + Tailwind CSS**
- **MongoDB** for conversation persistence
- **OpenCode Go (OpenAI-compatible API)** for LLM responses
  - default base URL: `https://opencode.ai/zen/go/v1`
  - configurable model via `OPENCODE_MODEL` (use a fast model included in your OpenCode Go plan)

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

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# MongoDB connection string (required for conversation history persistence)
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
MONGODB_DB=parent_coach

# OpenCode Go (OpenAI-compatible) API settings
OPENCODE_BASE_URL=https://opencode.ai/zen/go/v1
OPENCODE_API_KEY=your_opencode_go_api_key
# Model included in your OpenCode Go plan (fast/cheap recommended)
OPENCODE_MODEL=glm-5.1
```

> `.env.local` is gitignored and should never be committed.

### 4) Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5) Production build

```bash
npm run build
npm start
```

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import the GitHub repository in Vercel.
3. Add the following **Environment Variables** in the Vercel project settings:
   - `MONGODB_URI`
   - `MONGODB_DB` (e.g. `parent_coach`)
   - `OPENCODE_BASE_URL` (e.g. `https://opencode.ai/zen/go/v1`)
   - `OPENCODE_API_KEY`
   - `OPENCODE_MODEL` (a model included in your OpenCode Go plan)
4. Deploy. Vercel will build and host the Next.js app.

## Project structure

- `src/app/page.tsx` — chat UI and conversation history rendering
- `src/app/api/chat/route.ts` — chat API (loads/saves conversation, calls coach)
- `src/lib/coach.ts` — OpenCode Go LLM call, structured JSON parsing, safety/heuristic escalation
- `src/lib/mongodb.ts` — MongoDB client and helpers

## Safety notes

- The app is designed for **general, supportive parenting guidance** only.
- It must not be used as a substitute for professional medical, psychological, legal, or emergency services.
- Crisis/abuse/self-harm inputs trigger a clear escalation message with guidance to contact local emergency or crisis services immediately.

## How coding agents were used

This project was built with assistance from coding agents (DeepSeek Harness) to accelerate scaffolding, parallel implementation, and iteration:
- explored the local environment and requirements,
- scaffolded and implemented the Next.js app (UI, API, MongoDB persistence, OpenCode Go integration),
- added safety-focused prompting and heuristic escalation for crisis/abuse/self-harm cases,
- prepared documentation and deployment steps.

All generated code and configuration were reviewed and adjusted to meet the stated requirements (structured brief replies, safety boundaries, bilingual support, and conversation history).
