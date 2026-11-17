// Dynamic reply-shape layer for the Parent Coach chat API.
//
// Every turn resolves to one of three shapes:
//   chat   - short, warm human prose (greetings, venting, reactive follow-ups, meta)
//   plan   - concern summary + 2-4 concrete steps + check-in
//   safety - escalation: supportive text, explicit emergency note, 3 urgent steps
//
// Decision order: deterministic crisis check -> cheap LLM classifier -> heuristic
// fallback -> mode-specific generation call. Nothing here throws: every failure
// resolves to a deterministic fallback for the chosen mode.

import type { CoachReply, ConversationState, FollowUp, ReplyMode } from "./types";

/** Messages of history handed to the model (the route already trims to ~24). */
const HISTORY_LIMIT = 20;
/** Recent turns given to the routing classifier so follow-ups differ from small talk. */
const CLASSIFIER_HISTORY_LIMIT = 8;
/** The classifier is a cheap routing call and must answer fast. */
const CLASSIFIER_TIMEOUT_MS = 6000;
/** Generation gets a longer budget. */
const GENERATION_TIMEOUT_MS = 20000;

type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
type ModelBody = { messages: ModelMessage[]; temperature?: number; max_tokens?: number };
type ModelResult = { ok: true; text: string } | { ok: false; error: string };
type OpenAiChatResponse = { choices?: { message?: { content?: unknown } }[] };

/** What the routing classifier is allowed to tell us about a turn. */
type ClassifierOutput = {
  mode: ReplyMode;
  topic: string;
  child_age: string;
  strategies_tried: string[];
  open_question: string;
};

export type CoachTurn = { role: "user" | "assistant"; content: string };
export type CoachInput = {
  messages: CoachTurn[];
  latestUserText: string;
  sessionId?: string;
  state?: ConversationState;
};

function getConfig() {
  const apiKey = process.env.OPENCODE_API_KEY || process.env.OPENCODE_GO_API_KEY;
  const baseUrl = (process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go/openai/v1").replace(/\/+$/, "");
  const model = process.env.OPENCODE_MODEL || "beam-free";
  return { apiKey, baseUrl, model };
}

/** Shared OpenAI-compatible chat-completions call with a hard timeout. Never throws. */
async function callModel(body: ModelBody, timeoutMs: number, sessionId?: string): Promise<ModelResult> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return { ok: false, error: "missing_api_key" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    };
    if (sessionId) headers["x-opencode-session"] = sessionId;
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: "http_" + res.status + ": " + detail.slice(0, 200) };
    }
    const data = (await res.json()) as OpenAiChatResponse;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) return { ok: false, error: "empty_response" };
    return { ok: true, text };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: controller.signal.aborted ? "timeout" : reason };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ JSON helpers ----------------------------- */

/** First balanced {...} block, ignoring braces inside strings. */
function findBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** Tolerant JSON extraction: raw JSON, fenced blocks, or JSON inside stray prose. */
function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const candidates: string[] = [text.trim()];
  const fence = /```(?:\s*json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) candidates.push(match[1].trim());
  const balanced = findBalancedObject(text);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    if (!candidate) continue;
    // Second pass tolerates trailing commas, a common model slip.
    for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        const parsed: unknown = JSON.parse(attempt);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
      } catch {
        /* try the next candidate */
      }
    }
  }
  return null;
}

/* ------------------------------- sanitizers ------------------------------ */

function clean(value: unknown, maxLength = 400): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function cleanList(value: unknown, maxItems: number, maxLength = 240): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item, maxLength);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanSteps(value: unknown, maxItems: number): string[] {
  return cleanList(value, maxItems, 260)
    .map((step) => step.replace(/^\s*(?:\d+[.)]|[-*\u2022])\s*/, "").trim())
    .filter(Boolean);
}

function cleanFollowUp(value: unknown): FollowUp | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const question = clean(raw.question, 200);
  if (!question) return undefined;
  const suggested = clean(raw.suggested_time, 60);
  return suggested ? { question, suggested_time: suggested } : { question };
}

/** Chat prose should arrive list-free and markdown-free. */
function cleanProse(value: unknown): string {
  if (typeof value !== "string") return "";
  return clean(
    value
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^\s*#{1,6}\s+/gm, "")
      .replace(/^\s*[-*\u2022]\s+/gm, "")
      .replace(/\*\*|__/g, "")
      .replace(/^["'\s]+|["'\s]+$/g, ""),
    1200
  );
}

/* ------------------------- crisis + decision heuristics ------------------ */

/** Deterministic crisis screen (English + Roman Urdu). Safety always wins. */
export function heuristicCrisis(text: string): boolean {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return false;
  const patterns = [
    /suicid/, /kill (my|him|her|them|your)?self/, /end (my|his|her|their) life/, /self[- ]?harm/,
    /hurt (my|him|her|them)?self/, /want to die/, /don'?t want to live/, /wanna die/, /mar jana/, /khudkushi/,
    /hurt (my|the|a|his|her) (child|kid|son|daughter|baby|toddler)/, /kill (my|the|a|his|her) (child|kid|son|daughter|baby|toddler)/,
    /harm (my|the|a|his|her) (child|kid|son|daughter|baby|toddler)/, /might hurt/, /afraid i (will|might|may|could) hurt/,
    /\babuse\b/, /abusing/, /molest/, /rape/, /sexual abuse/, /beating/, /beaten/, /hit(ting)? (my )?(child|kid|son|daughter|baby)/,
    /choking/, /not breathing/, /unconscious/, /poison/, /overdose/, /bleeding heavily/, /emergency/, /immediate danger/, /in danger/,
    /threaten.*kill/, /gun/, /knife/, /weapon/, /maar raha/, /maar rahi/, /zyadti/, /jan se maar/, /nuksan/,
  ];
  return patterns.some((pattern) => pattern.test(t));
}

// Greetings, thanks and acknowledgements: brief human replies, not plans.
const GREETING_RE =
  /^(?:(?:hi+|hello+|hey+|hola|salam|assalam[o]?[ -]?alaikum|aoa|good(?: morning| night| evening)|gm|thanks?|thank (?:you|u)|thx|ty|ok(?:ay)?|sure|cool|great|nice|yes|yeah|yep|no|nope|haha+|lol|got it|gotcha|understood|shukriya|shukria|theek hai|theek|acha|accha|hmm+|oh|ah|wow|bye|please|there|all|everyone|so|much|a lot)[\s!.,?'\u2019]*)+$/i;
// "hi how are you" - a greeting plus pleasantries still means chat.
const GREETING_OPEN_RE = /^(?:hi+|hello+|hey+|salam|assalam|aoa)\b/;
const SMALLTALK_RE = /\bhow are (?:you|u)\b|\bhow'?s (?:it going|your day)\b|\bwhat'?s up\b|\bhow do you do\b/;
// Concrete problems: if one is named, the turn needs a plan, not just warmth.
const PROBLEM_RE =
  /\b(?:child|kid|kids|son|daughter|baby|toddler|teen|teenager|school|homework|bedtime|sleep|nap|screen|phone|tablet|hits|hitting|bite|bites|biting|refuses?|won'?t|does ?n'?t|meltdown|tantrum|fights?|fighting|shout(?:s|ing)?|scream(?:s|ing)?|lying|lies|ignores?|cries|crying|bully|bullying|teacher|class|grades|eating|eats|food|potty|toilet|sibling|brother|sister)\b/;
// Pure emotional venting needs warmth, not a structured plan.
const EMOTION_RE =
  /\b(?:i(?:'m| am| feel| felt| was)\s+(?:so |very |really |just )?(?:sad|tired|exhausted|overwhelmed|anxious|stressed|guilty|awful|terrible|lonely|frustrated|angry|upset|done|drained|worried|scared))\b|i (?:can'?t|cannot) (?:take|do|handle) (?:this|it) anymore|\bcrying\b|\bventing\b|\bjust need to (?:vent|talk)\b/;
// Meta questions about the app itself.
const META_RE =
  /\b(?:how (?:does|do) (?:this|you) work|what (?:can|do) you do|who are you|are you (?:a )?(?:bot|ai|real|human)|what is this (?:app|thing)|how do i use|is this (?:app )?free|what'?s this app|does this app (?:save|store))\b/;
// Short reactive messages that answer the coach rather than open a new problem.
const REACTIVE_RE =
  /^(?:it|that|this|nothing) (?:did ?n[o'\u2019]?t|did not|does ?n[o'\u2019]?t|does not|won'?t) (?:work|help|change)|^(?:i )?(?:already )?tried (?:it|that|this)|^(?:tell me more|more please|why|how come|really|and then|then what)\b/;

/** Deterministic replacement for the classifier: on failure, timeout or bad JSON. */
function heuristicMode(text: string): ReplyMode {
  const raw = (text || "").trim();
  if (!raw) return "chat";
  if (heuristicCrisis(raw)) return "safety";
  const compact = raw.toLowerCase().replace(/\s+/g, " ").trim();
  const short = compact.length < 40;
  if (short && (GREETING_RE.test(compact) || GREETING_OPEN_RE.test(compact) || SMALLTALK_RE.test(compact))) {
    return "chat";
  }
  if (META_RE.test(compact)) return "chat";
  if (compact.length < 90 && EMOTION_RE.test(compact) && !PROBLEM_RE.test(compact)) return "chat";
  if (compact.length < 60 && REACTIVE_RE.test(compact)) return "chat";
  return "plan";
}

/* -------------------------------- prompts -------------------------------- */

const CORE_RULES = `You are "Parent Coach", a calm, non-judgmental parenting companion for parents and caregivers.
LANGUAGE: reply in the language and script the parent used (English -> English, Urdu script -> Urdu script, Roman Urdu -> Roman Urdu); follow the recent conversation if the latest message is ambiguous.
SAFETY: never diagnose, never give medication/dosing/treatment or legal instructions; keep advice practical and point to appropriate local professional help when needed.
CONTEXT: continue the conversation and never repeat a strategy the parent already tried.`;

const CHAT_PROMPT = CORE_RULES + `

TASK: reply conversationally to this turn.
OUTPUT: JSON only, no fences: {"mode":"chat","text":"<reply>","follow_up":{"question":"...","suggested_time":"..."}}
RULES:
- "text": 1-3 short sentences of plain prose, warm and human, like a caring friend texting. No headings, numbered lists, "Plan:"/"Concern:" labels or markdown.
- If the parent says a strategy did not work, acknowledge it and gently offer ONE fresh small idea.
- A brief natural question inside "text" is fine; include "follow_up" only when a check-in genuinely helps. Do not add a safety disclaimer unless the situation truly calls for one.`;

const PLAN_PROMPT = CORE_RULES + `

TASK: give a short, concrete plan for the parenting concern in this turn.
OUTPUT: JSON only, no fences: {"mode":"plan","concern_summary":"<one line>","plan":["<step>","<step>"],"safety_note":"<note or empty string>","follow_up":{"question":"...","suggested_time":"..."}}
RULES:
- "concern_summary": one short sentence naming the concern in the parent's own words.
- "plan": 2-4 specific, doable steps for this parent's situation and the child's age. Use the context (especially strategies already tried) so you never repeat the same advice.
- "safety_note": include a short note ONLY when the concern touches health, development, legal or safety issues; otherwise use "".
- "follow_up": one caring check-in question plus a short suggested time.`;

const SAFETY_PROMPT = CORE_RULES + `

TASK: someone may be in immediate danger. Respond with calm, urgent human support and escalation.
OUTPUT: JSON only, no fences: {"mode":"safety","text":"...","safety_note":"...","plan":["...","...","..."],"follow_up":{"question":"...","suggested_time":"..."}}
RULES:
- "text": 2-3 short sentences of calm, supportive language. Stay with the parent; no blame, no judgement.
- "safety_note": MUST clearly state that this may be an emergency or serious safety concern, urge contacting local emergency services right now (112 / 911 or their local number) or a trusted local crisis/child-protection service, and say to stay with the person if it is safe to do so.
- "plan": exactly 3 short, urgent, safe steps. Never give instructions that could enable harm.
- "follow_up": one immediate check-in question (for example "Are you both safe right now?").`;

const MODE_SYSTEM_PROMPT: Record<ReplyMode, string> = {
  chat: CHAT_PROMPT,
  plan: PLAN_PROMPT,
  safety: SAFETY_PROMPT,
};

/** Compact rolling context so the coach continues instead of restarting. */
function contextBlock(state?: ConversationState): string {
  if (!state) return "";
  const lines: string[] = [];
  if (state.topic) lines.push("Topic: " + state.topic);
  if (state.child_age) lines.push("Child age: " + state.child_age);
  if (state.strategies_tried?.length) lines.push("Already tried: " + state.strategies_tried.join("; "));
  if (state.open_question) lines.push("Last check-in question (they may be answering it): " + state.open_question);
  return lines.length ? "CONVERSATION CONTEXT:\n- " + lines.join("\n- ") : "";
}

/* ------------------------------- fallbacks ------------------------------- */

const SAFETY_NOTE_FALLBACK =
  "This may be an emergency or a serious safety concern. Please contact your local emergency services now (112 / 911 or your local emergency number), or a trusted local crisis or child-protection service, and stay with the person if it is safe to do so.";

const FALLBACK_SAFETY_STEPS = [
  "If anyone is in immediate danger, call your local emergency number now (112 / 911) and move to a safe place if you can.",
  "Reach out to a trusted person nearby who can stay with you or your child right now - do not handle this alone.",
  "When you are safe, contact a local crisis line or child-protection service for urgent human guidance.",
];

const FALLBACK_PLAN_STEPS = [
  "Pick one calm moment today and describe what you noticed in plain, non-blaming words.",
  "Ask your child one open question about how it felt for them, then listen without fixing it.",
  "Choose one small, consistent step and agree together on when you will try it again.",
];

const EMERGENCY_RE = /emergency|112|911|999|108|crisis|helpline|child protection|immediate|urgent|danger|police/i;

/** Deterministic reply for the chosen mode; raw records why it was used. */
function fallbackFor(mode: ReplyMode): CoachReply {
  if (mode === "safety") {
    return {
      mode: "safety",
      text: "I'm really glad you told me - this sounds frightening, and reaching out was the right thing to do. Your safety and your child's safety come first right now. Please get real, immediate human help rather than handling this alone.",
      safety_note: SAFETY_NOTE_FALLBACK,
      plan: [...FALLBACK_SAFETY_STEPS],
      follow_up: { question: "Are you and your child safe right now?", suggested_time: "right now" },
      escalated: true,
    };
  }
  if (mode === "plan") {
    return {
      mode: "plan",
      concern_summary: "You shared a parenting situation and want something concrete to try.",
      plan: [...FALLBACK_PLAN_STEPS],
      follow_up: { question: "How did the first step feel when you tried it?", suggested_time: "tomorrow" },
      escalated: false,
    };
  }
  return {
    mode: "chat",
    text: "I'm here with you. That sounds like a lot to carry, and it makes sense that you are thinking about it. Tell me a little more when you have a moment - I'm listening.",
    escalated: false,
  };
}

/* ------------------------------ reply shaping ---------------------------- */

function shapeChat(parsed: Record<string, unknown>, fallback: CoachReply): CoachReply {
  const text = cleanProse(parsed.text) || cleanProse(parsed.reply) || fallback.text || "";
  const followUp = cleanFollowUp(parsed.follow_up);
  return { mode: "chat", text, ...(followUp ? { follow_up: followUp } : {}), escalated: false };
}

function shapePlan(parsed: Record<string, unknown>, fallback: CoachReply): CoachReply {
  const steps = cleanSteps(parsed.plan, 4);
  const note = clean(parsed.safety_note, 260);
  const reply: CoachReply = {
    mode: "plan",
    concern_summary: clean(parsed.concern_summary, 180) || fallback.concern_summary,
    plan: steps.length >= 2 ? steps : fallback.plan,
    follow_up: cleanFollowUp(parsed.follow_up) || fallback.follow_up,
    escalated: false,
  };
  if (note) reply.safety_note = note;
  return reply;
}

function shapeSafety(parsed: Record<string, unknown>, fallback: CoachReply): CoachReply {
  const note = clean(parsed.safety_note, 400);
  const steps = cleanSteps(parsed.plan, 3);
  return {
    mode: "safety",
    text: cleanProse(parsed.text) || fallback.text || "",
    // The escalation note is mandatory and must name emergency help.
    safety_note: note && EMERGENCY_RE.test(note) ? note : SAFETY_NOTE_FALLBACK,
    plan: steps.length >= 3 ? steps.slice(0, 3) : fallback.plan,
    follow_up: cleanFollowUp(parsed.follow_up) || fallback.follow_up,
    escalated: true,
  };
}

/* ----------------------------- state merging ----------------------------- */

/** Dedupes (case-insensitively), drops empties and caps at the 6 most recent. */
function mergeStrategies(previous?: string[], incoming?: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const item of [...(previous || []), ...(incoming || [])]) {
    const strategy = clean(item, 160);
    if (!strategy) continue;
    const key = strategy.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(strategy);
  }
  return merged.slice(-6);
}

/** Classifier output wins, previous state fills the gaps. */
function mergeState(
  previous: ConversationState | undefined,
  classification: ClassifierOutput | null,
  reply: CoachReply
): ConversationState {
  const next: ConversationState = {};
  const topic = clean(classification?.topic, 80) || clean(previous?.topic, 80);
  if (topic) next.topic = topic;
  const childAge = clean(classification?.child_age, 20) || clean(previous?.child_age, 20);
  if (childAge) next.child_age = childAge;
  const strategies = mergeStrategies(previous?.strategies_tried, classification?.strategies_tried);
  if (strategies.length) next.strategies_tried = strategies;
  // The coach's latest check-in becomes the open question for the next turn.
  const openQuestion =
    clean(reply.follow_up?.question, 200) ||
    clean(classification?.open_question, 200) ||
    clean(previous?.open_question, 200);
  if (openQuestion) next.open_question = openQuestion;
  return next;
}

/* ------------------------------- pipeline -------------------------------- */

function buildHistory(messages: CoachTurn[] | undefined, latestUserText: string): ModelMessage[] {
  const history: ModelMessage[] = [];
  for (const message of messages || []) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content) history.push({ role: message.role, content });
  }
  const latest = (latestUserText || "").trim();
  if (latest) {
    const last = history[history.length - 1];
    // The route already appends the new message; avoid sending it twice.
    if (!last || last.role !== "user" || last.content !== latest) history.push({ role: "user", content: latest });
  }
  return history.slice(-HISTORY_LIMIT);
}

const CLASSIFIER_PROMPT = `You are the routing classifier for "Parent Coach", a parenting-support chat app. Decide how the coach should answer the parent's latest message, using the recent conversation to tell a follow-up from a fresh topic.

Modes:
- "chat": greetings, thanks, acknowledgements, small talk, emotional venting, clarifying questions, short reactive messages (e.g. "it didn't work"), answers to the coach's check-in that only need a brief human reply, or meta questions about the app.
- "plan": the parent describes a concrete parenting problem, behaviour or situation and wants actionable help.
- "safety": emergency, abuse, self-harm, violence or immediate danger to anyone.

Rules:
- If there is any sign of immediate danger, choose "safety".
- "topic": at most 8 words describing the concern currently being discussed.
- "child_age": only if the parent stated an age (e.g. "5"), otherwise "".
- "strategies_tried": short labels for strategies the parent said they already tried, deduped, at most 6, [] if none.
- "open_question": the coach's latest unanswered check-in question if the parent is replying to it, otherwise "".

Reply with JSON only, no fences: {"mode":"chat"|"plan"|"safety","topic":"...","child_age":"...","strategies_tried":["..."],"open_question":"..."}`;

/** Cheap routing call: returns null on any failure so the heuristic takes over. */
async function classify(
  history: ModelMessage[],
  latestUserText: string,
  sessionId?: string
): Promise<ClassifierOutput | null> {
  const transcript = history
    .slice(-CLASSIFIER_HISTORY_LIMIT)
    .map((message) => (message.role === "user" ? "Parent: " : "Coach: ") + message.content)
    .join("\n");
  const userContent =
    "Recent conversation (oldest first):\n" +
    (transcript || "(none)") +
    '\n\nLatest parent message:\n"""' +
    latestUserText +
    '"""\n\nClassify the latest parent message. Reply with JSON only.';

  const result = await callModel(
    {
      messages: [
        { role: "system", content: CLASSIFIER_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0,
      max_tokens: 300,
    },
    CLASSIFIER_TIMEOUT_MS,
    sessionId
  );
  if (!result.ok) return null;

  const parsed = extractJson<Record<string, unknown>>(result.text);
  if (!parsed) return null;
  const mode = typeof parsed.mode === "string" ? parsed.mode.trim().toLowerCase() : "";
  if (mode !== "chat" && mode !== "plan" && mode !== "safety") return null;

  return {
    mode,
    topic: clean(parsed.topic, 80),
    child_age: clean(parsed.child_age, 20),
    strategies_tried: cleanList(parsed.strategies_tried, 6, 140),
    open_question: clean(parsed.open_question, 200),
  };
}

/** One generation call per mode so the payload always matches the reply shape. */
async function generateForMode(
  mode: ReplyMode,
  history: ModelMessage[],
  state: ConversationState | undefined,
  sessionId?: string
): Promise<CoachReply> {
  const fallback = fallbackFor(mode);
  const context = contextBlock(state);
  const messages: ModelMessage[] = [
    { role: "system", content: context ? MODE_SYSTEM_PROMPT[mode] + "\n\n" + context : MODE_SYSTEM_PROMPT[mode] },
    ...history,
  ];
  if (messages.length < 2) return { ...fallback, raw: "empty_input" };

  const result = await callModel(
    { messages, temperature: mode === "safety" ? 0.25 : 0.6, max_tokens: 800 },
    GENERATION_TIMEOUT_MS,
    sessionId
  );
  if (!result.ok) return { ...fallback, raw: "generation_error: " + result.error };

  const raw = result.text.slice(0, 2000);
  const parsed = extractJson<Record<string, unknown>>(result.text);
  if (!parsed) return { ...fallback, raw };

  const reply =
    mode === "safety"
      ? shapeSafety(parsed, fallback)
      : mode === "plan"
        ? shapePlan(parsed, fallback)
        : shapeChat(parsed, fallback);
  reply.raw = raw;
  return reply;
}

/**
 * Main entry point. Decides the reply shape for the turn, generates it with a
 * mode-specific prompt, and returns the updated rolling state. Never throws.
 */
export async function generateCoachReply(
  input: CoachInput
): Promise<{ reply: CoachReply; state: ConversationState }> {
  const latestUserText = typeof input?.latestUserText === "string" ? input.latestUserText.trim() : "";
  const history = buildHistory(input?.messages, latestUserText);
  const previousState = input?.state;

  try {
    // a. Deterministic crisis screen first: skips the classifier round-trip.
    const crisis = heuristicCrisis(latestUserText);
    let classification: ClassifierOutput | null = null;
    let mode: ReplyMode;

    if (crisis) {
      mode = "safety";
    } else {
      // b. Cheap classifier; c. heuristic when it fails, times out or is unparsable.
      classification = await classify(history, latestUserText, input?.sessionId);
      mode = classification?.mode ?? heuristicMode(latestUserText);
    }

    // d. Safety always wins: both paths above already resolve to "safety".
    const reply = await generateForMode(mode, history, previousState, input?.sessionId);
    if (mode === "safety") {
      reply.mode = "safety";
      reply.escalated = true;
    }
    return { reply, state: mergeState(previousState, classification, reply) };
  } catch (error) {
    // Contract: never throw. Degrade to a deterministic reply for a safe mode.
    const fallbackMode: ReplyMode = heuristicCrisis(latestUserText) ? "safety" : "chat";
    const reply = fallbackFor(fallbackMode);
    reply.raw = "fatal: " + (error instanceof Error ? error.message : String(error));
    return { reply, state: mergeState(previousState, null, reply) };
  }
}
