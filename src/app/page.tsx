"use client";

import { useEffect, useRef, useState } from "react";

type AssistantReply = {
  concern_summary: string;
  safety_note: string;
  plan: string[];
  follow_up: { question: string; suggested_time?: string };
  escalated: boolean;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  meta?: { escalated?: boolean };
};

function parseAssistant(content: string): AssistantReply | null {
  try {
    const obj = JSON.parse(content);
    if (obj && typeof obj === "object" && obj.concern_summary && obj.safety_note) {
      return {
        concern_summary: String(obj.concern_summary),
        safety_note: String(obj.safety_note),
        plan: Array.isArray(obj.plan) ? obj.plan.map((x: any) => String(x)) : [],
        follow_up: {
          question: String(obj.follow_up?.question || ""),
          suggested_time: obj.follow_up?.suggested_time ? String(obj.follow_up.suggested_time) : "",
        },
        escalated: Boolean(obj.escalated),
      };
    }
  } catch {}
  return null;
}

function Bubble({ m }: { m: Message }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end animate-rise">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--accent)] px-4 py-3 text-white shadow-sm">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.content}</p>
        </div>
      </div>
    );
  }
  const parsed = parseAssistant(m.content);
  if (!parsed) {
    return (
      <div className="flex justify-start animate-rise">
        <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-[var(--surface)] border border-[var(--line)] px-4 py-3 shadow-sm">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ink)]">{m.content}</p>
        </div>
      </div>
    );
  }
  const escalated = parsed.escalated;
  return (
    <div className="flex justify-start animate-rise">
      <div className={"max-w-[92%] rounded-2xl rounded-bl-md border px-4 py-4 shadow-sm " + (escalated ? "bg-[var(--warn-bg)] border-[var(--warn-line)]" : "bg-[var(--surface)] border-[var(--line)]")}>
        <div className="flex items-center gap-2 mb-2">
          <span className={"inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold " + (escalated ? "bg-[#f5d8d1] text-[var(--warn)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>
            {escalated ? "Safety escalation" : "Coach plan"}
          </span>
          <span className="text-xs text-[var(--muted)]">Brief & practical</span>
        </div>
        <p className="text-[15px] leading-relaxed text-[var(--ink)] mb-3"><span className="font-semibold">Concern:</span> {parsed.concern_summary}</p>
        <div className={"rounded-xl px-3 py-2 mb-3 text-sm leading-relaxed " + (escalated ? "bg-white/70 text-[var(--warn)] border border-[var(--warn-line)]" : "bg-[var(--bg-soft)] text-[var(--muted)] border border-[var(--line)]")}>
          <span className="font-semibold">Safety note: </span>{parsed.safety_note}
        </div>
        <div className="mb-3">
          <p className="text-sm font-semibold text-[var(--ink)] mb-1.5">Plan</p>
          <ol className="space-y-1.5">
            {parsed.plan.map((step, i) => (
              <li key={i} className="flex gap-2 text-[15px] leading-relaxed text-[var(--ink)]">
                <span className={"mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold " + (escalated ? "bg-[var(--warn)] text-white" : "bg-[var(--accent)] text-white")}>{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-xl bg-white/70 border border-[var(--line)] px-3 py-2">
          <p className="text-sm text-[var(--ink)]"><span className="font-semibold">Check-in:</span> {parsed.follow_up.question}</p>
          {parsed.follow_up.suggested_time ? (
            <p className="text-xs text-[var(--muted)] mt-1">Suggested time: {parsed.follow_up.suggested_time}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const starters = [
  "My 6-year-old refuses to do homework every evening. What can I try?",
  "Mera bacha raat ko sone se pehle bohot roota hai, main kya karun?",
  "My teen spends too much time on screens and gets angry when I set limits.",
];

export default function Home() {
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("pc_session_id") : null;
    if (saved) {
      setSessionId(saved);
      fetch(`/api/chat?sessionId=${encodeURIComponent(saved)}`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d?.messages)) setMessages(d.messages); })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || loading) return;
    setError("");
    setInput("");
    const optimistic: Message = { role: "user", content: msg, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId || undefined, message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong");
      if (data?.sessionId) {
        setSessionId(data.sessionId);
        try { localStorage.setItem("pc_session_id", data.sessionId); } catch {}
      }
      if (Array.isArray(data?.messages)) {
        setMessages(data.messages);
      } else if (data?.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: JSON.stringify(data.reply), createdAt: new Date().toISOString() }]);
      }
    } catch (e: any) {
      setError(e?.message || "Could not reach the coach. Please try again.");
      setMessages((prev) => prev.filter((m) => m !== optimistic));
      setInput(msg);
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    setSessionId("");
    setMessages([]);
    setError("");
    try { localStorage.removeItem("pc_session_id"); } catch {}
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="shell relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(31,107,87,0.18),transparent_70%)] blur-2xl" />
      <div className="pointer-events-none absolute top-20 right-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(217,122,74,0.18),transparent_70%)] blur-2xl" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/70 border border-[var(--line)] px-3 py-1.5 text-xs font-semibold tracking-wide text-[var(--muted)] shadow-sm mb-4">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)] animate-float"></span>
              English & Urdu • Structured, safety-aware coaching
            </div>
            <h1 className="display text-4xl sm:text-5xl font-semibold tracking-tight text-[var(--ink)] leading-[1.05]">A calmer way to handle tough parenting moments.</h1>
            <p className="mt-3 text-base sm:text-[17px] leading-relaxed text-[var(--muted)]">
              Share a concern in English or Urdu and receive a brief summary, a clear safety note, 2–4 practical steps, and a caring follow-up check-in. This is general support — not diagnosis, medical, or legal advice.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={newChat} className="focus-ring rounded-full border border-[var(--line)] bg-white/80 px-4 py-2.5 text-sm font-semibold text-[var(--ink)] hover:bg-white hover:shadow-sm transition">
              New conversation
            </button>
            <div className="hidden sm:flex items-center rounded-full bg-[var(--accent-soft)] px-4 py-2 text-xs font-semibold text-[var(--accent-strong)] border border-emerald-900/10">No login • History saved on page</div>
          </div>
        </header>

        <main className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
          <section className="card-glass flex min-h-[72vh] flex-col rounded-[28px] border border-[var(--line)] shadow-[var(--shadow)] overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 space-y-4 scroll-smoothbar">
              {!hasMessages && (
                <div className="animate-rise">
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-soft)] p-5 mb-4">
                    <h2 className="display text-xl font-semibold text-[var(--ink)] mb-2">How can I support you today?</h2>
                    <p className="text-[15px] leading-relaxed text-[var(--muted)] mb-4">
                      Describe what’s going on with your child in English or Urdu. You’ll receive a short summary, a safety note, 2–4 practical steps, and a follow-up check-in.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-1">
                      {starters.map((s, i) => (
                        <button key={i} onClick={() => setInput(s)} className="text-left rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]/30 transition">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {messages.map((m, i) => <Bubble key={i} m={m} />)}
              {loading && (
                <div className="flex justify-start animate-rise">
                  <div className="rounded-2xl rounded-bl-md border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)] shadow-sm">
                    Thinking of a calm, practical plan…
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-[var(--line)] bg-white/70 p-3 sm:p-4">
              {error && <p className="mb-2 text-sm text-[var(--warn)]">{error}</p>}
              <form
                onSubmit={(e) => { e.preventDefault(); send(input); }}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
              >
                <label className="sr-only" htmlFor="concern">Your concern</label>
                <textarea
                  id="concern"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your concern in English or Urdu… (e.g. homework struggles, bedtime, screen time)"
                  rows={3}
                  className="focus-ring flex-1 resize-none rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-3 text-[15px] leading-relaxed text-[var(--ink)] placeholder:text-[#8a948d] focus:border-[var(--accent)]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="focus-ring inline-flex h-12 items-center justify-center rounded-2xl bg-[var(--accent)] px-6 text-sm font-semibold text-white hover:bg-[var(--accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm sm:w-auto"
                >
                  {loading ? "Sending…" : "Get support"}
                </button>
              </form>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Press Enter to send, Shift+Enter for a new line. If there is immediate danger, contact local emergency services now.
              </p>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="card-glass rounded-[24px] border border-[var(--line)] p-5 shadow-[var(--shadow-soft)]">
              <h3 className="display text-lg font-semibold text-[var(--ink)] mb-2">What you’ll get</h3>
              <ul className="space-y-2 text-sm text-[var(--muted)]">
                <li className="flex gap-2"><span className="text-[var(--accent)]">•</span><span>A short summary of your concern</span></li>
                <li className="flex gap-2"><span className="text-[var(--accent)]">•</span><span>A clear safety note</span></li>
                <li className="flex gap-2"><span className="text-[var(--accent)]">•</span><span>2–4 practical steps you can try</span></li>
                <li className="flex gap-2"><span className="text-[var(--accent)]">•</span><span>A caring follow-up check-in (question or time)</span></li>
              </ul>
            </div>
            <div className="rounded-[24px] border border-[var(--warn-line)] bg-[var(--warn-bg)]/90 p-5 shadow-[var(--shadow-soft)]">
              <h3 className="display text-lg font-semibold text-[var(--warn)] mb-2">Safety & limits</h3>
              <p className="text-sm leading-relaxed text-[#6e332a] mb-2">
                The coach does <strong>not</strong> diagnose and does <strong>not</strong> provide medical or legal instructions.
              </p>
              <p className="text-sm leading-relaxed text-[#6e332a]">
                If you describe an emergency, abuse, or self-harm, it will clearly escalate and urge you to contact local emergency or crisis/child protection services immediately (e.g. 112/911).
              </p>
            </div>
            <div className="card-glass rounded-[24px] border border-[var(--line)] p-5 shadow-[var(--shadow-soft)]">
              <h3 className="display text-lg font-semibold text-[var(--ink)] mb-2">Privacy note</h3>
              <p className="text-sm leading-relaxed text-[var(--muted)]">
                Conversations are stored to show history on this page (no login). Avoid sharing names, addresses, or other sensitive personal details.
              </p>
            </div>
          </aside>
        </main>
      </div>
    </div>
  );
}
