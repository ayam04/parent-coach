"use strict";
// Shared contract for the dynamic coach response layer.
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderReplyText = renderReplyText;
/** Renders a reply to plain text so it can be stored as model-readable history. */
function renderReplyText(reply) {
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
