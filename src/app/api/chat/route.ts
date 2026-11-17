import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { generateCoachReply } from "@/lib/coach";
import { renderReplyText } from "@/lib/types";
import type { ChatMessage, ConversationState } from "@/lib/types";
import crypto from "crypto";

/** How many turns of history we hand to the model. */
const MAX_HISTORY = 24;

/** Strips the debug-only field before the payload leaves the server. */
function publicReply(reply: any) {
  if (!reply) return null;
  const { raw, ...rest } = reply;
  return rest;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    let sessionId = typeof body?.sessionId === "string" && body.sessionId ? body.sessionId : "";

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: "Message is too long (max 2000 characters)." }, { status: 400 });
    }

    const db = await getDb();
    const col = db.collection("conversations");
    const now = new Date().toISOString();

    if (!sessionId) sessionId = crypto.randomUUID();

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
      content: renderReplyText(reply),
      reply,
      createdAt: new Date().toISOString(),
      meta: { mode: reply.mode, escalated: reply.escalated },
    };

    await col.updateOne(
      { sessionId },
      {
        $push: { messages: { $each: [userMsg, assistantMsg] } },
        $set: { updatedAt: new Date().toISOString(), state: state || {} },
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
  } catch (e: any) {
    console.error("chat api error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ messages: [], state: {} });
    const db = await getDb();
    const col = db.collection("conversations");
    const convo = await col.findOne({ sessionId });
    return NextResponse.json({
      sessionId,
      messages: Array.isArray(convo?.messages) ? convo!.messages : [],
      state: convo?.state || {},
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
