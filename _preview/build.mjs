import { compile } from "tailwindcss";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const projectRoot = process.cwd();
const require = createRequire(projectRoot + "/package.json");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const mod = require("./_preview/_preview_src.js");
const Home = mod.default;
const { PlanCard, SafetyCard, MessageRow } = mod;

const plan = {
  mode: "plan",
  escalated: false,
  concern_summary: "Evening homework turns into a daily argument with your 7-year-old.",
  plan: [
    "Pick one fixed 15-minute homework window and put it on a visible chart.",
    "Start with the easiest task so she gets an early win.",
    "Sit nearby without correcting, and praise the effort out loud.",
    "End with a two-minute reset: water, a stretch, then free play.",
  ],
  safety_note:
    "If refusal comes with headaches, stomach aches, or big meltdowns most days, mention it to your paediatrician.",
  follow_up: { question: "How did the first 15-minute window go tonight?", suggested_time: "Tomorrow evening" },
};

const safety = {
  mode: "safety",
  escalated: true,
  text: "Thank you for saying this out loud. What you described is serious and needs support tonight.",
  safety_note:
    "Put distance between you and your child right now and call local emergency services or a crisis line. If you are in Pakistan, 1122 is the rescue service; elsewhere use 112 or 911.",
  plan: [
    "Move to a different room, or hand your child to another trusted adult.",
    "Call a local crisis or emergency line and stay on the line.",
    "Do not drive or handle your baby while you are this flooded.",
  ],
  follow_up: { question: "Can you tell me who is with you right now?", suggested_time: "Next 10 minutes" },
};

const chat = {
  mode: "chat",
  escalated: false,
  text: "That sounds like a hard evening. Homework battles at seven usually mean the task feels too big, not that your child is lazy. Try naming the feeling first, then offering one small choice about where to start.",
  follow_up: { question: "Which part of homework sets off the struggle first?", suggested_time: "Tomorrow" },
};

const user = {
  role: "user",
  content: "My 7-year-old refuses to do homework every evening. What can I try?",
  createdAt: "2026-01-01T00:00:00.000Z",
};
const assistantChat = {
  role: "assistant",
  content: "",
  reply: chat,
  createdAt: "2026-01-01T00:00:01.000Z",
  meta: { mode: "chat" },
};

const h = React.createElement;
const cards = renderToStaticMarkup(
  h("main", { className: "mx-auto w-full max-w-[820px] px-4 py-8 sm:px-6" },
    h("div", { className: "rounded-[26px] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-6 shadow-[var(--shadow)]" },
      h("div", { className: "space-y-4 sm:space-y-5" },
        h(MessageRow, { message: user }),
        h(MessageRow, { message: assistantChat }),
        h(PlanCard, { reply: plan }),
        h(SafetyCard, { reply: safety })
      )
    )
  )
);

const home = renderToStaticMarkup(h(Home));

const head = [
  "<!doctype html>",
  "<html lang='en'>",
  "<head>",
  "<meta charset='utf-8' />",
  "<meta name='viewport' content='width=device-width, initial-scale=1' />",
  "<title>Parent Coach preview</title>",
  "<link rel='preconnect' href='https://fonts.googleapis.com' />",
  "<link rel='preconnect' href='https://fonts.gstatic.com' crossorigin />",
  "<link href='https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700&display=swap' rel='stylesheet' />",
  "<link rel='stylesheet' href='./app.css' />",
  "</head>",
  "<body class='min-h-screen bg-[var(--bg)] text-[var(--ink)] antialiased'>"
].join("\n");

const shell = (body) => head + "\n" + body + "\n</body>\n</html>";
const homeHtml = shell(home);
const cardsHtml = shell(cards);

const cssPath = resolve(projectRoot, "src/app/globals.css");
const cssText = readFileSync(cssPath, "utf8");
const loadStylesheet = async (id, base) => {
  if (id === "tailwindcss") {
    const f = require.resolve("tailwindcss/index.css");
    return { path: f, base: dirname(f), content: readFileSync(f, "utf8") };
  }
  const c = resolve(base, id);
  const f = existsSync(c) ? c : require.resolve(id);
  return { path: f, base: dirname(f), content: readFileSync(f, "utf8") };
};
const compiler = await compile(cssText, { base: dirname(cssPath), loadStylesheet });

const tokens = new Set();
for (const blob of [homeHtml, cardsHtml]) {
  const re = /class="([^"]*)"/g;
  let m;
  while ((m = re.exec(blob)) !== null) {
    for (const t of m[1].split(" ")) if (t) tokens.add(t);
  }
}
for (const t of ["min-h-screen", "bg-[var(--bg)]", "text-[var(--ink)]", "antialiased"]) tokens.add(t);

const css = compiler.build([...tokens]);
const fonts = ':root{--font-display:"Fraunces";--font-body:"Manrope";}html{--font-display:"Fraunces";--font-body:"Manrope";}';
writeFileSync(resolve(projectRoot, "_preview/app.css"), fonts + "\n" + css, "utf8");
writeFileSync(resolve(projectRoot, "_preview/home.html"), homeHtml, "utf8");
writeFileSync(resolve(projectRoot, "_preview/cards.html"), cardsHtml, "utf8");
console.log("preview built:", css.length, "css bytes;", tokens.size, "tokens;", home.length, "home;", cards.length, "cards");
