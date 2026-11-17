export type CoachReply = {
  concern_summary: string;
  safety_note: string;
  plan: string[];
  follow_up: { question: string; suggested_time?: string };
  escalated: boolean;
  raw: string;
};

const SYSTEM_PROMPT = `You are "Parent Coach", a calm, practical parenting support assistant. You help parents/caregivers think through everyday concerns about children (behavior, routines, school, emotions, communication, screen time, sibling conflict, etc.). You may respond in English or Urdu depending on the language used by the parent.

NON-NEGOTIABLE SAFETY RULES:
- Do NOT diagnose any medical, psychological, or developmental condition.
- Do NOT give medical instructions (no medication, dosing, treatment, or diagnosis) and do NOT give legal instructions.
- Keep advice brief, practical, and supportive. Focus on communication, routines, empathy, supervision, and seeking appropriate professional/local support when needed.
- If the message describes an emergency, immediate danger, abuse (physical/sexual/emotional), neglect, violence, a child in danger, or self-harm/suicidal thoughts (by parent or child): you MUST escalate clearly. State that this may be an emergency or serious safety concern, encourage contacting local emergency services immediately (e.g. 112/911 or the local emergency number) or a trusted local crisis/child protection service, and staying with the person if safe. Do not provide instructions that could enable harm. Still provide a short supportive response and a follow-up check-in question, but prioritize safety.
- Be culturally sensitive and non-judgmental.

OUTPUT FORMAT:
Always respond with VALID JSON only (no markdown fences, no extra text) matching exactly this schema:
{
  "concern_summary": "1 short sentence summarizing the parent's concern",
  "safety_note": "1 short sentence. If escalated, clearly state emergency/safety concern and urge immediate local help; otherwise a gentle reminder that this is general support, not diagnosis/medical/legal advice.",
  "plan": ["2-4 brief, practical steps"],
  "follow_up": { "question": "one caring check-in question", "suggested_time": "optional short suggestion like 'in 2 hours' or 'tomorrow evening' or empty string" },
  "escalated": true or false
}

Keep each field concise. "plan" must have 2 to 4 items.`;

function extractJson(text: string): any {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}
  const fence = trimmed.match(/```(?:json)?s*([sS]*?)```/i);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch {}
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  return null;
}

export function heuristicCrisis(text: string): boolean {
  const t = text.toLowerCase();
  const patterns = [
    /suicid/, /kill (my|him|her|them)?self/, /end (my|his|her) life/, /self[- ]?harm/,
    /hurt (my|him|her|them)?self/, /want to die/, /don't want to live/, /don'?t want to live/, /mar jana/, /khudkushi/,
    /abuse/, /abusing/, /molest/, /rape/, /sexual abuse/, /beating/, /beaten/, /hit(ting)? (my )?(child|kid|son|daughter|baby)/,
    /choking/, /not breathing/, /unconscious/, /poison/, /overdose/, /bleeding heavily/, /emergency/, /immediate danger/,
    /threaten.*kill/, /gun/, /knife/, /maar raha/, /maar rahi/, /zyadti/, /jan se maar/,
  ];
  return patterns.some((p) => p.test(t));
}

export async function generateCoachReply(
  messages: { role: "user" | "assistant"; content: string }[],
  latestUserText: string
): Promise<CoachReply> {
  const apiKey = process.env.OPENCODE_API_KEY || process.env.OPENCODE_GO_API_KEY;
  const baseUrl = (process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/go/v1").replace(//$/, "");
  const model = process.env.OPENCODE_MODEL || "glm-5.1";

  const crisis = heuristicCrisis(latestUserText);

  const fallback = (): CoachReply => ({
    concern_summary: "You shared a parenting concern and need support.",
    safety_note: crisis
      ? "This may be an emergency or serious safety concern. If anyone is in immediate danger, please contact your local emergency number now (e.g. 112/911) or a trusted local crisis/child protection service and stay with the person if safe."
      : "This is general support, not a diagnosis or medical/legal advice. If you are worried about safety or health, please contact a local professional.",
    plan: crisis
      ? [
          "If there is immediate danger, call your local emergency number right now and move to a safe place if possible.",
          "Reach out to a trusted person nearby who can stay with you and help right now.",
          "When safe, contact a local child protection or crisis helpline for urgent guidance.",
        ]
      : [
          "Take a slow breath and choose one calm moment to connect with your child.",
          "Name what you are noticing in simple words and listen to their perspective.",
          "Pick one small, consistent step you can try today and observe how it goes.",
        ],
    follow_up: {
      question: crisis
        ? "Are you and your child in a safe place right now?"
        : "How did things feel after you tried one small step?",
      suggested_time: crisis ? "right now / in 30 minutes" : "later today or tomorrow",
    },
    escalated: crisis,
    raw: "",
  });

  if (!apiKey) {
    const fb = fallback();
    fb.raw = "(no_api_key_fallback)";
    return fb;
  }

  const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
  const system = SYSTEM_PROMPT + (crisis ? "

IMPORTANT: The latest message may indicate a crisis/emergency/abuse/self-harm. You MUST set escalated=true and provide a clear safety_note urging immediate local emergency/crisis/child protection help." : "");
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      ...history,
    ],
    temperature: 0.3,
  };

  try {
    const res = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      const fb = fallback();
      fb.raw = "API_ERROR " + res.status + ": " + txt.slice(0, 500);
      return fb;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    const parsed = extractJson(text);
    if (!parsed) {
      const fb = fallback();
      fb.raw = text;
      return fb;
    }
    const planArr = Array.isArray(parsed.plan) ? parsed.plan.map((x: any) => String(x)).slice(0, 4) : fallback().plan;
    const reply: CoachReply = {
      concern_summary: String(parsed.concern_summary || "Parenting concern shared."),
      safety_note: String(parsed.safety_note || fallback().safety_note),
      plan: planArr.length >= 2 ? planArr : fallback().plan,
      follow_up: {
        question: String(parsed.follow_up?.question || fallback().follow_up.question),
        suggested_time: parsed.follow_up?.suggested_time ? String(parsed.follow_up.suggested_time) : fallback().follow_up.suggested_time,
      },
      escalated: Boolean(parsed.escalated) || crisis,
      raw: text,
    };
    if (reply.escalated && !/emergency|112|911|crisis|immediate|danger|urgent/i.test(reply.safety_note)) {
      reply.safety_note = "This may be an emergency or serious safety concern. If anyone is in immediate danger, please contact your local emergency number now (e.g. 112/911) or a trusted local crisis/child protection service.";
    }
    return reply;
  } catch (e: any) {
    const fb = fallback();
    fb.raw = "EXCEPTION: " + (e?.message || String(e));
    return fb;
  }
}
