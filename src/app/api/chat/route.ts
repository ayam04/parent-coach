import { NextRequest, NextResponse } from "next/server";
import { getDb, type ChatMessage } from "@/lib/mongodb";
import { generateCoachReply } from "@/lib/coach";
import crypto from "crypto";

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

    if (!sessionId) {
      sessionId = crypto.randomUUID();
    }

    let convo = await col.findOne<{ sessionId: string; messages: ChatMessage[] }>({ sessionId });
    if (!convo) {
      const doc = { sessionId, messages: [] as ChatMessage[], createdAt: now, updatedAt: now };
      await col.insertOne(doc);
      convo = doc;
    }

    const userMsg: ChatMessage = { role: "user", content: message, createdAt: now };
    const historyForModel = [...(convo.messages || []), userMsg].map((m) => ({ role: m.role, content: m.content }));
    const reply = await generateCoachReply(historyForModel, message, sessionId);

    const assistantContent = JSON.stringify({
      concern_summary: reply.concern_summary,
      safety_note: reply.safety_note,
      plan: reply.plan,
      follow_up: reply.follow_up,
      escalated: reply.escalated,
    });

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: assistantContent,
      createdAt: new Date().toISOString(),
      meta: { escalated: reply.escalated },
    };

    await col.updateOne(
      { sessionId },
      {
        $push: { messages: { $each: [userMsg, assistantMsg] } } as any,
        $set: { updatedAt: new Date().toISOString() },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    const updated = await col.findOne<{ sessionId: string; messages: ChatMessage[] }>({ sessionId });
    return NextResponse.json({
      sessionId,
      reply: {
        concern_summary: reply.concern_summary,
        safety_note: reply.safety_note,
        plan: reply.plan,
        follow_up: reply.follow_up,
        escalated: reply.escalated,
      },
      debug: { raw: (reply as any).raw?.slice?.(0, 500) || null, model: process.env.OPENCODE_MODEL || "beam-free", base: (process.env.OPENCODE_BASE_URL || "").slice(0,60) },
      messages: updated?.messages || [userMsg, assistantMsg],
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
    if (!sessionId) return NextResponse.json({ messages: [] });
    const db = await getDb();
    const col = db.collection("conversations");
    const convo = await col.findOne<{ sessionId: string; messages: ChatMessage[] }>({ sessionId });
    return NextResponse.json({ sessionId, messages: convo?.messages || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
