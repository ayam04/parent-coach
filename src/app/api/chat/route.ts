import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { generateCoachReply } from "@/lib/coach";
import { renderReplyText } from "@/lib/types";
import type { ChatMessage, ConversationState } from "@/lib/types";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import crypto from "crypto";

/** How many turns of history we hand to the model. */
const MAX_HISTORY = 24;

/** Hard cap on persisted turns so a conversation document cannot grow without bound. */
const MAX_STORED_MESSAGES = 200;

/** Defensive cap on the assistant text we persist (the model layer already limits it). */
const MAX_STORED_CONTENT = 4000;

/** Defensive caps for the rolling state we persist. */
const MAX_STATE_STRING = 400;
const MAX_STATE_ITEMS = 10;

/**
 * Only canonical UUID v4 ids are accepted. Sessions are bearer capability
 * tokens: refusing arbitrary strings stops enumeration/probing with guessed
 * or hand-crafted ids.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What clients see for any unexpected failure; details stay in the server log. */
const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Strips the debug-only field before the payload leaves the server. */
function publicReply(reply: any) {
  if (!reply) return null;
  const { raw, ...rest } = reply;
  return rest;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/** Keeps only known state fields, with defensive length caps. */
function boundedState(state: ConversationState | undefined): ConversationState {
  if (!state || typeof state !== "object") return {};
  const next: ConversationState = {};
  if (typeof state.topic === "string" && state.topic) {
    next.topic = truncate(state.topic, MAX_STATE_STRING);
  }
  if (typeof state.child_age === "string" && state.child_age) {
    next.child_age = truncate(state.child_age, MAX_STATE_STRING);
  }
  if (Array.isArray(state.strategies_tried)) {
    const strategies = state.strategies_tried
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .slice(0, MAX_STATE_ITEMS)
      .map((item) => truncate(item, MAX_STATE_STRING));
    if (strategies.length) next.strategies_tried = strategies;
  }
  if (typeof state.open_question === "string" && state.open_question) {
    next.open_question = truncate(state.open_question, MAX_STATE_STRING);
  }
  return next;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const rawSessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    // Invalid or absent ids are replaced with a fresh one instead of trusted.
    const suppliedSessionId = UUID_V4.test(rawSessionId) ? rawSessionId.toLowerCase() : "";
    const sessionId = suppliedSessionId || crypto.randomUUID();

    // Cheap abuse/cost guard: a limited request never reaches Mongo or the model.
    // The session budget only applies to an id the client actually supplied;
    // new conversations are bounded by the per-IP budget instead.
    const limit = checkRateLimit({ ip: getClientIp(req), sessionId: suppliedSessionId || null });
    if (!limit.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: "Message is too long (max 2000 characters)." }, { status: 400 });
    }

    const db = await getDb();
    const col = db.collection("conversations");
    const now = new Date().toISOString();

    const existing = await col.findOne({ sessionId });
    const priorMessages: ChatMessage[] = Array.isArray(existing?.messages) ? existing!.messages : [];
    const priorState: ConversationState | undefined = existing?.state;

    if (!existing) {
      await col.insertOne({ sessionId, messages: [], state: {}, createdAt: now, updatedAt: now });
    }

    const userMsg: ChatMessage = { role: "user", content: message, createdAt: now };
    const history = [...priorMessages, userMsg]
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content }));

    const { reply, state } = await generateCoachReply({
      messages: history,
      latestUserText: message,
      sessionId,
      state: priorState,
    });

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: truncate(renderReplyText(reply), MAX_STORED_CONTENT),
      reply,
      createdAt: new Date().toISOString(),
      meta: { mode: reply.mode, escalated: reply.escalated },
    };

    await col.updateOne(
      { sessionId },
      {
        $push: {
          messages: {
            $each: [userMsg, assistantMsg],
            // Keep only the most recent turns: unbounded arrays would otherwise
            // grow the document until it hits Mongo's 16MB limit.
            $slice: -MAX_STORED_MESSAGES,
          },
        },
        $set: { updatedAt: new Date().toISOString(), state: boundedState(state) },
        $setOnInsert: { createdAt: now },
      } as any,
      { upsert: true }
    );

    const updated = await col.findOne({ sessionId });
    const messages: ChatMessage[] = Array.isArray(updated?.messages)
      ? (updated!.messages as ChatMessage[])
      : [userMsg, assistantMsg];

    return NextResponse.json({
      sessionId,
      mode: reply.mode,
      reply: publicReply(reply),
      state: updated?.state || state || {},
      messages,
    });
  } catch (e) {
    console.error("chat api error", e);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawSessionId = (searchParams.get("sessionId") || "").trim();
    if (!UUID_V4.test(rawSessionId)) {
      return NextResponse.json({ error: "Invalid sessionId." }, { status: 400 });
    }
    const sessionId = rawSessionId.toLowerCase();

    const db = await getDb();
    const col = db.collection("conversations");
    const convo = await col.findOne({ sessionId });
    return NextResponse.json({
      sessionId,
      messages: Array.isArray(convo?.messages) ? convo!.messages : [],
      state: convo?.state || {},
    });
  } catch (e) {
    console.error("chat api GET error", e);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
