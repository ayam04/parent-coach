"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Home;
exports.PlanCard = PlanCard;
exports.SafetyCard = SafetyCard;
exports.MessageRow = MessageRow;
exports.FollowUpRow = FollowUpRow;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const STORAGE_KEY = "pc_session_id";
const MAX_MESSAGE = 2000;
const STARTERS = [
    {
        tag: "Everyday",
        text: "My 7-year-old refuses to do homework every evening. What can I try?",
    },
    {
        tag: "Roman Urdu",
        text: "Mera beta raat ko sone se pehle bohot rota hai. Main kya karun?",
    },
    {
        tag: "Check-in",
        text: "I lost my patience and shouted at my daughter today. I feel guilty and I do not know how to repair it.",
    },
];
/* ------------------------------------------------------------------ */
/* API payload parsing: the UI trusts the shape, not the network.      */
/* ------------------------------------------------------------------ */
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function asText(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function asTextList(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const item of value) {
        const text = asText(item);
        if (text)
            out.push(text);
    }
    return out;
}
function asMode(value) {
    return value === "chat" || value === "plan" || value === "safety" ? value : undefined;
}
function parseFollowUp(value) {
    if (!isRecord(value))
        return undefined;
    const question = asText(value.question);
    if (!question)
        return undefined;
    const suggested = asText(value.suggested_time);
    const followUp = { question };
    if (suggested)
        followUp.suggested_time = suggested;
    return followUp;
}
function parseReply(value) {
    if (!isRecord(value))
        return undefined;
    const mode = asMode(value.mode) ?? "chat";
    const text = asText(value.text);
    const concern = asText(value.concern_summary);
    const steps = asTextList(value.plan);
    const note = asText(value.safety_note);
    const followUp = parseFollowUp(value.follow_up);
    if (!text && !concern && steps.length === 0 && !note && !followUp)
        return undefined;
    const reply = {
        mode,
        escalated: value.escalated === true || mode === "safety",
    };
    if (text)
        reply.text = text;
    if (concern)
        reply.concern_summary = concern;
    if (steps.length > 0)
        reply.plan = steps;
    if (note)
        reply.safety_note = note;
    if (followUp)
        reply.follow_up = followUp;
    return reply;
}
function parseMessages(value) {
    if (!Array.isArray(value))
        return [];
    const messages = [];
    for (const item of value) {
        if (!isRecord(item))
            continue;
        const role = item.role === "user" || item.role === "assistant" ? item.role : null;
        if (role === null)
            continue;
        const content = typeof item.content === "string" ? item.content : "";
        const reply = role === "assistant" ? parseReply(item.reply) : undefined;
        if (!content.trim() && !reply)
            continue;
        const createdAt = typeof item.createdAt === "string" && item.createdAt ? item.createdAt : new Date().toISOString();
        const message = { role, content, createdAt };
        if (reply)
            message.reply = reply;
        const metaSource = isRecord(item.meta) ? item.meta : undefined;
        const mode = metaSource ? asMode(metaSource.mode) : undefined;
        const escalated = metaSource?.escalated === true;
        if (mode || escalated) {
            const meta = {};
            if (mode)
                meta.mode = mode;
            if (escalated)
                meta.escalated = true;
            message.meta = meta;
        }
        messages.push(message);
    }
    return messages;
}
function errorText(body) {
    if (!isRecord(body))
        return null;
    return asText(body.error) ?? null;
}
function friendlyError(caught) {
    if (caught instanceof Error && caught.message) {
        if (!/failed to fetch|networkerror|load failed/i.test(caught.message)) {
            return caught.message;
        }
    }
    return "Could not reach the coach. Check your connection and try again.";
}
function readStoredSession() {
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    }
    catch {
        return null;
    }
}
function storeSession(sessionId) {
    try {
        window.localStorage.setItem(STORAGE_KEY, sessionId);
    }
    catch {
        /* Storage can be unavailable; the in-memory session still works. */
    }
}
function clearStoredSession() {
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    }
    catch {
        /* Nothing to clean up. */
    }
}
/* ------------------------------------------------------------------ */
/* Reply rendering: three distinct shapes.                            */
/* ------------------------------------------------------------------ */
function FollowUpRow({ followUp, tone = "accent" }) {
    const isWarn = tone === "warn";
    return ((0, jsx_runtime_1.jsxs)("div", { className: "mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-dashed pt-2.5 " +
            (isWarn ? "border-[var(--warn-line)]" : "border-[var(--line)]"), children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow " + (isWarn ? "text-[var(--warn)]" : "text-[var(--accent-strong)]"), children: "Check-in" }), (0, jsx_runtime_1.jsx)("span", { dir: "auto", className: "text-[13px] leading-relaxed text-[var(--ink)]", children: followUp.question }), followUp.suggested_time ? ((0, jsx_runtime_1.jsx)("span", { className: "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                    (isWarn
                        ? "border border-[var(--warn-line)] bg-white text-[var(--warn-ink)]"
                        : "bg-[var(--accent-soft)] text-[var(--accent-strong)]"), children: followUp.suggested_time })) : null] }));
}
/** "plan" mode: restatement, numbered steps, optional limits note, check-in. */
function PlanCard({ reply }) {
    const steps = reply.plan ?? [];
    return ((0, jsx_runtime_1.jsxs)("article", { className: "w-full max-w-[660px] animate-rise overflow-hidden rounded-[20px] border border-[var(--line)] bg-[var(--surface-solid)] shadow-[var(--shadow-soft)]", children: [(0, jsx_runtime_1.jsx)("div", { "aria-hidden": "true", className: "h-[3px] w-full bg-[linear-gradient(90deg,var(--accent)_0%,var(--accent-strong)_55%,var(--accent-2)_100%)]" }), (0, jsx_runtime_1.jsxs)("div", { className: "px-4 py-4 sm:px-5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow text-[var(--accent-strong)]", children: "A plan to try" }), steps.length > 0 ? ((0, jsx_runtime_1.jsxs)("span", { className: "ml-auto text-[11px] font-medium text-[var(--muted)]", children: [steps.length, " steps"] })) : null] }), reply.concern_summary ? ((0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "display mt-2 text-[18px] font-semibold leading-[1.35] text-[var(--ink)] sm:text-[19px]", children: reply.concern_summary })) : null, steps.length > 0 ? ((0, jsx_runtime_1.jsx)("ol", { className: "mt-4 space-y-3", children: steps.map((step, index) => ((0, jsx_runtime_1.jsxs)("li", { className: "flex gap-3", children: [(0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", className: "display mt-[1px] flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-[8px] border border-[var(--line)] bg-[var(--accent-soft)] text-[12px] font-semibold text-[var(--accent-strong)]", children: index + 1 }), (0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "text-[14px] leading-[1.6] text-[var(--ink)]", children: step })] }, index))) })) : null, reply.safety_note ? ((0, jsx_runtime_1.jsxs)("div", { className: "mt-4 rounded-[13px] border border-[var(--line)] bg-[var(--bg-soft)] px-3.5 py-2.5", children: [(0, jsx_runtime_1.jsx)("p", { className: "eyebrow text-[var(--muted)]", children: "Keep in mind" }), (0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "mt-1 text-[12.5px] leading-relaxed text-[var(--ink-soft)]", children: reply.safety_note })] })) : null, reply.follow_up ? (0, jsx_runtime_1.jsx)(FollowUpRow, { followUp: reply.follow_up }) : null] })] }));
}
/** "safety" mode: escalation styling, safety note first, urgent steps. */
function SafetyCard({ reply, fallback }) {
    const text = reply?.text ?? fallback ?? "";
    const note = reply?.safety_note;
    const steps = reply?.plan ?? [];
    return ((0, jsx_runtime_1.jsx)("article", { role: "group", "aria-label": "Safety reply from the coach", style: { borderLeftColor: "var(--warn)" }, className: "w-full max-w-[680px] animate-rise overflow-hidden rounded-[20px] border border-l-[4px] border-[var(--warn-line)] bg-[var(--warn-bg)] shadow-[0_12px_30px_rgba(154,53,40,0.10)]", children: (0, jsx_runtime_1.jsxs)("div", { className: "px-4 py-4 sm:px-5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2", children: [(0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", className: "flex h-5 w-5 items-center justify-center rounded-full bg-[var(--warn)] text-[11px] font-bold leading-none text-[#fff8f5]", children: "!" }), (0, jsx_runtime_1.jsx)("span", { className: "eyebrow text-[var(--warn)]", children: "Safety first" })] }), text ? ((0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "display mt-2.5 text-[17px] font-semibold leading-[1.45] text-[var(--warn-ink)] sm:text-[18px]", children: text })) : null, note ? ((0, jsx_runtime_1.jsxs)("div", { className: "mt-3.5 rounded-[13px] border border-[var(--warn-line)] bg-[#fffcf9] px-3.5 py-3", children: [(0, jsx_runtime_1.jsx)("p", { className: "eyebrow text-[var(--warn)]", children: "Important" }), (0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "mt-1 text-[13px] font-medium leading-relaxed text-[var(--warn-ink)]", children: note })] })) : null, steps.length > 0 ? ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("p", { className: "eyebrow mt-4 text-[var(--warn)]", children: "Do this now" }), (0, jsx_runtime_1.jsx)("ol", { className: "mt-2 space-y-2.5", children: steps.map((step, index) => ((0, jsx_runtime_1.jsxs)("li", { className: "flex gap-3", children: [(0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", className: "mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--warn)] text-[11px] font-bold text-[#fff8f5]", children: index + 1 }), (0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "text-[13.5px] font-medium leading-[1.6] text-[var(--warn-ink)]", children: step })] }, index))) })] })) : null, reply?.follow_up ? (0, jsx_runtime_1.jsx)(FollowUpRow, { followUp: reply.follow_up, tone: "warn" }) : null] }) }));
}
function AssistantRow({ message }) {
    const reply = message.reply;
    const mode = reply?.mode ?? message.meta?.mode ?? "chat";
    const plain = message.content.trim();
    if (mode === "safety" && (reply || plain)) {
        return (0, jsx_runtime_1.jsx)(SafetyCard, { reply: reply, fallback: plain });
    }
    if (mode === "plan" && reply && (reply.plan?.length || reply.concern_summary)) {
        return (0, jsx_runtime_1.jsx)(PlanCard, { reply: reply });
    }
    const body = reply?.text ?? plain;
    if (!body)
        return null;
    return ((0, jsx_runtime_1.jsx)("div", { className: "flex justify-start animate-rise", children: (0, jsx_runtime_1.jsxs)("div", { className: "max-w-[92%] rounded-[18px] rounded-bl-[6px] border border-[var(--line)] bg-[var(--surface-solid)] px-4 py-3 shadow-[var(--shadow-soft)] sm:max-w-[600px]", children: [(0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "whitespace-pre-wrap break-words text-[14.5px] leading-[1.65] text-[var(--ink)]", children: body }), reply?.follow_up ? (0, jsx_runtime_1.jsx)(FollowUpRow, { followUp: reply.follow_up }) : null] }) }));
}
function MessageRow({ message }) {
    if (message.role === "user") {
        return ((0, jsx_runtime_1.jsx)("div", { className: "flex justify-end animate-rise", children: (0, jsx_runtime_1.jsx)("div", { className: "max-w-[88%] rounded-[18px] rounded-br-[6px] bg-[var(--accent)] px-4 py-3 shadow-[0_8px_20px_rgba(31,107,87,0.18)] sm:max-w-[540px]", children: (0, jsx_runtime_1.jsx)("p", { dir: "auto", className: "whitespace-pre-wrap break-words text-[14.5px] leading-[1.6] text-[var(--on-accent)]", children: message.content }) }) }));
    }
    return (0, jsx_runtime_1.jsx)(AssistantRow, { message: message });
}
/* ------------------------------------------------------------------ */
/* Supporting regions.                                                */
/* ------------------------------------------------------------------ */
function EmptyState({ onPick }) {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "mx-auto flex min-h-full w-full max-w-[620px] flex-col justify-center px-1 py-2 animate-rise", children: [(0, jsx_runtime_1.jsx)("p", { className: "eyebrow text-[var(--accent-strong)]", children: "Start here" }), (0, jsx_runtime_1.jsx)("h2", { className: "display mt-2 text-[23px] font-semibold leading-[1.18] text-[var(--ink)] sm:text-[27px]", children: "What happened today?" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-2 max-w-[52ch] text-[14px] leading-relaxed text-[var(--muted)]", children: "Write it in English or Roman Urdu, in your own words. Add your child's age and what you have already tried if you can." }), (0, jsx_runtime_1.jsx)("p", { className: "mt-5 text-[12px] font-medium text-[var(--muted)]", children: "Or start from one of these" }), (0, jsx_runtime_1.jsx)("ul", { className: "-mt-1 divide-y divide-[var(--line)] border-t border-[var(--line)]", children: STARTERS.map((starter) => ((0, jsx_runtime_1.jsx)("li", { children: (0, jsx_runtime_1.jsxs)("button", { type: "button", onClick: () => onPick(starter.text), className: "focus-ring group flex w-full items-start gap-3 rounded-[10px] py-3 text-left transition-colors", children: [(0, jsx_runtime_1.jsx)("span", { className: "eyebrow mt-[3px] w-[84px] shrink-0 text-[var(--muted)] transition-colors group-hover:text-[var(--accent-strong)]", children: starter.tag }), (0, jsx_runtime_1.jsx)("span", { dir: "auto", className: "flex-1 text-[13.5px] leading-[1.55] text-[var(--ink)] transition-colors group-hover:text-[var(--accent-strong)]", children: starter.text }), (0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", className: "mt-[1px] text-[13px] text-[var(--muted-2)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--accent-strong)]", children: "\u2192" })] }) }, starter.tag))) }), (0, jsx_runtime_1.jsx)("p", { className: "mt-4 text-[11.5px] leading-relaxed text-[var(--muted)]", children: "General support, not a diagnosis or a replacement for professional care." })] }));
}
function LoadingState() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "mx-auto w-full max-w-[520px] space-y-3 py-2", children: [(0, jsx_runtime_1.jsx)("p", { className: "sr-only", children: "Loading your previous conversation" }), (0, jsx_runtime_1.jsx)("div", { "aria-hidden": "true", className: "ml-auto h-11 w-[52%] rounded-[16px] skeleton" }), (0, jsx_runtime_1.jsx)("div", { "aria-hidden": "true", className: "h-24 w-[86%] rounded-[18px] skeleton" }), (0, jsx_runtime_1.jsx)("div", { "aria-hidden": "true", className: "ml-auto h-11 w-[40%] rounded-[16px] skeleton" }), (0, jsx_runtime_1.jsx)("div", { "aria-hidden": "true", className: "h-16 w-[70%] rounded-[18px] skeleton" })] }));
}
function TypingRow() {
    return ((0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-2.5 pl-1 animate-rise", "aria-hidden": "true", children: [(0, jsx_runtime_1.jsx)("span", { className: "grid h-7 w-7 place-items-center rounded-full border border-[var(--line)] bg-[var(--accent-soft)] text-[9px] font-bold tracking-wide text-[var(--accent-strong)]", children: "PC" }), (0, jsx_runtime_1.jsxs)("span", { className: "flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-solid)] px-3 py-2.5 shadow-[var(--shadow-soft)]", children: [(0, jsx_runtime_1.jsx)("span", { className: "typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" }), (0, jsx_runtime_1.jsx)("span", { className: "typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]", style: { animationDelay: "0.15s" } }), (0, jsx_runtime_1.jsx)("span", { className: "typing-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]", style: { animationDelay: "0.3s" } })] }), (0, jsx_runtime_1.jsx)("span", { className: "text-[12px] text-[var(--muted)]", children: "Thinking it through" })] }));
}
function ErrorNotice({ message, onDismiss }) {
    return ((0, jsx_runtime_1.jsxs)("div", { role: "alert", className: "mb-2.5 flex items-start gap-2.5 rounded-[14px] border border-[var(--warn-line)] bg-[var(--warn-bg)] px-3 py-2.5", children: [(0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", className: "mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--warn)] text-[10px] font-bold text-[#fff8f5]", children: "!" }), (0, jsx_runtime_1.jsxs)("div", { className: "min-w-0 flex-1", children: [(0, jsx_runtime_1.jsx)("p", { className: "text-[12.5px] font-semibold leading-snug text-[var(--warn-ink)]", children: message }), (0, jsx_runtime_1.jsx)("p", { className: "mt-0.5 text-[11.5px] leading-snug text-[var(--warn-ink)]", children: "Your message is still in the box, so nothing is lost." })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: onDismiss, className: "focus-ring -mr-1 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[var(--warn)] transition hover:bg-[var(--surface-raised)]", children: "Dismiss" })] }));
}
/* ------------------------------------------------------------------ */
/* Page.                                                              */
/* ------------------------------------------------------------------ */
function Home() {
    const [sessionId, setSessionId] = (0, react_1.useState)("");
    const [messages, setMessages] = (0, react_1.useState)([]);
    const [input, setInput] = (0, react_1.useState)("");
    const [sending, setSending] = (0, react_1.useState)(false);
    const [hydrating, setHydrating] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)("");
    const listRef = (0, react_1.useRef)(null);
    const textareaRef = (0, react_1.useRef)(null);
    const requestRef = (0, react_1.useRef)(0);
    const hasMessages = messages.length > 0;
    /* Restore the anonymous session, then hydrate its history. */
    (0, react_1.useEffect)(() => {
        let cancelled = false;
        const stored = readStoredSession();
        if (!stored) {
            setHydrating(false);
            return;
        }
        const session = stored;
        const epoch = requestRef.current;
        setSessionId(session);
        async function hydrate() {
            try {
                const response = await fetch("/api/chat?sessionId=" + encodeURIComponent(session));
                if (!response.ok)
                    return;
                const body = await response.json();
                if (cancelled || requestRef.current !== epoch || !isRecord(body))
                    return;
                const history = parseMessages(body.messages);
                if (history.length > 0)
                    setMessages(history);
            }
            catch {
                /* Keep the empty state; the next message starts a fresh turn. */
            }
            finally {
                if (!cancelled && requestRef.current === epoch)
                    setHydrating(false);
            }
        }
        void hydrate();
        return () => {
            cancelled = true;
        };
    }, []);
    /* Keep the newest turn in view without moving the page. */
    (0, react_1.useEffect)(() => {
        const list = listRef.current;
        if (!list)
            return;
        const reduce = typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        list.scrollTo({ top: list.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    }, [messages, sending, hydrating]);
    /* Grow the composer with its content, up to a calm limit. */
    (0, react_1.useEffect)(() => {
        const field = textareaRef.current;
        if (!field)
            return;
        field.style.height = "auto";
        field.style.height = Math.min(field.scrollHeight, 168) + "px";
    }, [input]);
    function focusComposer() {
        if (typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches) {
            textareaRef.current?.focus();
        }
    }
    async function send() {
        const text = input.trim();
        if (!text || sending || hydrating)
            return;
        const requestId = requestRef.current + 1;
        requestRef.current = requestId;
        const optimistic = {
            role: "user",
            content: text,
            createdAt: new Date().toISOString(),
        };
        setError("");
        setInput("");
        setSending(true);
        setMessages((previous) => [...previous, optimistic]);
        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: text, sessionId: sessionId || undefined }),
            });
            let body = null;
            try {
                body = await response.json();
            }
            catch {
                body = null;
            }
            if (requestRef.current !== requestId)
                return;
            if (!response.ok) {
                throw new Error(errorText(body) ?? "The coach could not reply just now. Please try again.");
            }
            const record = isRecord(body) ? body : {};
            const nextSession = asText(record.sessionId);
            const serverMessages = parseMessages(record.messages);
            const lastAssistant = [...serverMessages].reverse().find((message) => message.role === "assistant");
            if (lastAssistant) {
                setMessages((previous) => [...previous, lastAssistant]);
            }
            else {
                const reply = parseReply(record.reply);
                if (reply) {
                    setMessages((previous) => [
                        ...previous,
                        {
                            role: "assistant",
                            content: reply.concern_summary || reply.text || "",
                            reply,
                            createdAt: new Date().toISOString(),
                            meta: { mode: reply.mode, escalated: reply.escalated },
                        },
                    ]);
                }
            }
            if (nextSession) {
                setSessionId(nextSession);
                storeSession(nextSession);
            }
        }
        catch (caught) {
            if (requestRef.current !== requestId)
                return;
            setMessages((previous) => previous.filter((message) => message !== optimistic));
            setInput(text);
            setError(friendlyError(caught));
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
        finally {
            if (requestRef.current === requestId) {
                setSending(false);
                requestAnimationFrame(focusComposer);
            }
        }
    }
    function startNewConversation() {
        requestRef.current += 1;
        setSessionId("");
        setMessages([]);
        setInput("");
        setError("");
        setSending(false);
        setHydrating(false);
        clearStoredSession();
        requestAnimationFrame(() => textareaRef.current?.focus());
    }
    function pickStarter(text) {
        setInput(text);
        requestAnimationFrame(() => textareaRef.current?.focus());
    }
    function handleSubmit(event) {
        event.preventDefault();
        void send();
    }
    function handleKeyDown(event) {
        if (event.key !== "Enter" || event.shiftKey)
            return;
        if (event.nativeEvent.isComposing)
            return;
        event.preventDefault();
        void send();
    }
    const statusText = hydrating
        ? "Loading your previous conversation"
        : sending
            ? "The coach is writing a reply"
            : "";
    return ((0, jsx_runtime_1.jsxs)("div", { className: "relative flex min-h-[100dvh] flex-col", children: [(0, jsx_runtime_1.jsxs)("header", { className: "relative z-10 mx-auto w-full max-w-[1180px] px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-start justify-between gap-3", children: [(0, jsx_runtime_1.jsxs)("div", { className: "flex items-center gap-3", children: [(0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", className: "display grid h-10 w-10 place-items-center rounded-[13px] bg-[var(--accent)] text-[14px] font-semibold text-[var(--on-accent)] shadow-[0_6px_16px_rgba(31,107,87,0.26)]", children: "PC" }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("p", { className: "display text-[17px] font-semibold leading-none text-[var(--ink)]", children: "Parent Coach" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1 text-[11.5px] font-medium text-[var(--muted)]", children: "English and Roman Urdu" })] })] }), (0, jsx_runtime_1.jsx)("button", { type: "button", onClick: startNewConversation, className: "focus-ring inline-flex shrink-0 items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-[12px] font-semibold text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)] active:translate-y-[1px] sm:px-3.5 sm:text-[12.5px]", children: "New conversation" })] }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-6 max-w-[640px] sm:mt-7", children: [(0, jsx_runtime_1.jsxs)("h1", { className: "display text-[30px] font-semibold leading-[1.06] text-[var(--ink)] sm:text-[38px] lg:text-[42px]", children: ["A calmer way through the", " ", (0, jsx_runtime_1.jsx)("span", { className: "text-[var(--accent-2-ink)]", children: "hard moments" }), "."] }), (0, jsx_runtime_1.jsx)("p", { className: "mt-2.5 max-w-[58ch] text-[14px] leading-relaxed text-[var(--muted)] sm:text-[15px]", children: "Share what is happening with your child. You will get a short answer, a plan, or safety steps, depending on the moment." })] })] }), (0, jsx_runtime_1.jsxs)("main", { className: "relative z-10 mx-auto grid w-full max-w-[1180px] flex-1 grid-cols-1 items-start gap-6 px-4 pb-8 pt-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-7 lg:px-8", children: [(0, jsx_runtime_1.jsxs)("section", { "aria-label": "Conversation", "aria-busy": sending || hydrating, className: "flex h-[calc(100dvh-290px)] min-h-[420px] flex-col overflow-hidden rounded-[26px] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow)] sm:h-[calc(100dvh-310px)] lg:h-[calc(100dvh-260px)] lg:min-h-[500px]", children: [(0, jsx_runtime_1.jsx)("div", { ref: listRef, role: "log", "aria-live": "polite", "aria-relevant": "additions", "aria-label": "Conversation messages", tabIndex: 0, className: "scroll-slim focus-ring min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-5 pt-4 sm:px-5", children: hydrating && !hasMessages ? ((0, jsx_runtime_1.jsx)(LoadingState, {})) : !hasMessages ? ((0, jsx_runtime_1.jsx)(EmptyState, { onPick: pickStarter })) : ((0, jsx_runtime_1.jsxs)("div", { className: "space-y-4 sm:space-y-5", children: [messages.map((message, index) => ((0, jsx_runtime_1.jsx)(MessageRow, { message: message }, message.createdAt + "-" + index))), sending ? (0, jsx_runtime_1.jsx)(TypingRow, {}) : null] })) }), (0, jsx_runtime_1.jsxs)("form", { onSubmit: handleSubmit, className: "shrink-0 border-t border-[var(--line)] bg-[var(--surface-solid)] px-3 pb-3 pt-3 sm:px-4 sm:pb-3.5", children: [error ? (0, jsx_runtime_1.jsx)(ErrorNotice, { message: error, onDismiss: () => setError("") }) : null, (0, jsx_runtime_1.jsxs)("div", { className: "flex items-end gap-2 rounded-[18px] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-1.5 py-1.5 transition focus-within:border-[var(--accent)] focus-within:shadow-[0_0_0_3px_rgba(31,107,87,0.14)]", children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "concern", className: "sr-only", children: "Describe your parenting concern" }), (0, jsx_runtime_1.jsx)("textarea", { id: "concern", ref: textareaRef, value: input, onChange: (event) => setInput(event.target.value), onKeyDown: handleKeyDown, disabled: sending || hydrating, rows: 1, maxLength: MAX_MESSAGE, placeholder: "Type what is happening, in English or Roman Urdu", "aria-describedby": "composer-hint", autoComplete: "off", enterKeyHint: "send", className: "block max-h-[168px] min-h-[44px] w-full resize-none bg-transparent px-2.5 py-2.5 text-[14.5px] leading-[1.55] text-[var(--ink)] placeholder:text-[var(--muted-2)] focus:outline-none disabled:opacity-60" }), (0, jsx_runtime_1.jsx)("button", { type: "submit", disabled: sending || hydrating || input.trim().length === 0, "aria-label": sending ? "Sending message" : "Send message", className: "focus-ring flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] bg-[var(--accent)] text-[17px] font-semibold text-[var(--on-accent)] shadow-[0_6px_16px_rgba(31,107,87,0.22)] transition hover:bg-[var(--accent-strong)] active:translate-y-[1px] disabled:cursor-not-allowed disabled:bg-[var(--bg-soft)] disabled:text-[var(--muted)] disabled:shadow-none disabled:active:translate-y-0", children: (0, jsx_runtime_1.jsx)("span", { "aria-hidden": "true", children: "\u2191" }) })] }), (0, jsx_runtime_1.jsxs)("div", { id: "composer-hint", className: "mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-[11px] leading-relaxed text-[var(--muted)]", children: [(0, jsx_runtime_1.jsx)("span", { children: "Enter to send, Shift + Enter for a new line" }), input.length > 1700 ? ((0, jsx_runtime_1.jsxs)("span", { className: input.length >= MAX_MESSAGE ? "font-semibold text-[var(--warn)]" : "", children: [input.length, "/", MAX_MESSAGE] })) : ((0, jsx_runtime_1.jsx)("span", { className: "hidden sm:inline", children: "General support, not medical advice" }))] })] })] }), (0, jsx_runtime_1.jsxs)("aside", { "aria-label": "How the coach works", className: "flex flex-col gap-6 lg:pt-1", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { className: "eyebrow text-[var(--muted)]", children: "How a reply is shaped" }), (0, jsx_runtime_1.jsxs)("div", { className: "mt-3.5 space-y-3.5", children: [(0, jsx_runtime_1.jsxs)("div", { className: "border-l-2 border-[var(--line-strong)] pl-3", children: [(0, jsx_runtime_1.jsx)("p", { className: "text-[13px] font-semibold text-[var(--ink)]", children: "A direct answer" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]", children: "For everyday questions, a short conversational reply." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "border-l-2 border-[var(--accent)] pl-3", children: [(0, jsx_runtime_1.jsx)("p", { className: "text-[13px] font-semibold text-[var(--accent-strong)]", children: "A plan to try" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]", children: "Two to four concrete steps, with a check-in question." })] }), (0, jsx_runtime_1.jsxs)("div", { className: "border-l-2 border-[var(--warn)] pl-3", children: [(0, jsx_runtime_1.jsx)("p", { className: "text-[13px] font-semibold text-[var(--warn)]", children: "Safety steps first" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-0.5 text-[12.5px] leading-relaxed text-[var(--muted)]", children: "When there is risk of harm, urgent steps and local help come first." })] })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "rounded-[18px] border border-[var(--warn-line)] bg-[var(--warn-bg)] p-4", children: [(0, jsx_runtime_1.jsx)("h2", { className: "display text-[16px] font-semibold text-[var(--warn-ink)]", children: "Safety and limits" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1.5 text-[12.5px] leading-relaxed text-[var(--warn-ink)]", children: "The coach does not diagnose, and it does not give medical or legal instructions." }), (0, jsx_runtime_1.jsx)("p", { className: "mt-1.5 text-[12.5px] leading-relaxed text-[var(--warn-ink)]", children: "If you describe an emergency, abuse, or self-harm, it puts safety steps first and urges you to contact local emergency or crisis services straight away, for example 112 or 911." })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h2", { className: "eyebrow text-[var(--muted)]", children: "Your privacy" }), (0, jsx_runtime_1.jsx)("p", { className: "mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]", children: "Your conversation is saved to an anonymous session ID in this browser, so you can pick it up later. There is no login. Avoid sharing names, addresses, or other identifying details." })] })] })] }), (0, jsx_runtime_1.jsx)("p", { className: "sr-only", role: "status", "aria-live": "polite", children: statusText })] }));
}
