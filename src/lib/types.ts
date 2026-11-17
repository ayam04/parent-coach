// Shared contract for the dynamic coach response layer.

export type ReplyMode = "chat" | "plan" | "safety";

export type FollowUp = {
  question: string;
  suggested_time?: string;
};

/**
 * A single coach reply. The shape is dynamic: only the fields relevant to
 * `mode` are present, everything else is optional.
 */
export type CoachReply = {
  mode: ReplyMode;
  /** Natural conversational prose. Used by "chat" and "safety" modes. */
  text?: string;
  /** One-line restatement of the concern. Used by "plan" mode. */
  concern_summary?: string;
  /** 2-4 concrete steps. Used by "plan" mode. */
  plan?: string[];
  /** Short limits note. Optional, only when genuinely useful. */
  safety_note?: string;
  follow_up?: FollowUp;
  escalated: boolean;
  /** Raw model output, kept for debugging and never shown in the UI. */
  raw?: string;
};

/** Rolling, bounded context that lets the coach remember the conversation. */
export type ConversationState = {
  topic?: string;
  child_age?: string;
  strategies_tried?: string[];
  open_question?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  /** Plain text: what the model reads as history and what the UI falls back to. */
  content: string;
  /** Structured payload for assistant messages so the UI can re-render on reload. */
  reply?: CoachReply;
  createdAt: string;
  meta?: {
    mode?: ReplyMode;
    escalated?: boolean;
  };
};

export type Conversation = {
  _id?: string;
  sessionId: string;
  messages: ChatMessage[];
  state?: ConversationState;
  createdAt: string;
  updatedAt: string;
};

/** Renders a reply to plain text so it can be stored as model-readable history. */
export function renderReplyText(reply: CoachReply): string {
  if (reply.mode === "plan") {
    const steps = (reply.plan || []).map((s, i) => `${i + 1}. ${s}`).join("\n");
    const note = reply.safety_note ? `\nNote: ${reply.safety_note}` : "";
    const follow = reply.follow_up?.question ? `\nCheck-in: ${reply.follow_up.question}` : "";
    return `Plan for: ${reply.concern_summary || "the concern"}\n${steps}${note}${follow}`;
  }
  const base = reply.text || "";
  const note = reply.mode === "safety" && reply.safety_note ? `\n\n${reply.safety_note}` : "";
  const follow = reply.follow_up?.question ? `\n\n${reply.follow_up.question}` : "";
  return `${base}${note}${follow}`.trim();
}
