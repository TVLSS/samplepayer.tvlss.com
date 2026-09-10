// Generates site/ from site-src/. Page copy lives in site-src/pages.mjs; tool
// tables and system chips are read from the agent definitions in api/src so
// the pages can't drift from the code. Plain Node, no dependencies beyond
// esbuild (already an api devDependency).
import { createRequire } from "node:module";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { pages, home } from "../site-src/pages.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { build } = createRequire(path.join(root, "api/package.json"))("esbuild");
const out = path.join(root, "site");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "site-src/assets"), path.join(out, "assets"), { recursive: true });

await build({ entryPoints: [path.join(root, "api/src/agents/index.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(root, "api/dist/site-agents.js"), target: "node22", logLevel: "silent" });
const { agents } = await import(pathToFileURL(path.join(root, "api/dist/site-agents.js")));

const SYSTEM_NAMES = {
  MEDICAL_CORE: "Medical core", DENTAL_ADMIN: "Dental admin", VISION_PARTNER: "Vision vendor", PBM: "Pharmacy (PBM)", SPENDING_ACCOUNTS: "FSA / HSA",
  MEMBERSHIP: "Membership", GROUP_ADMIN: "Group admin", BILLING: "Billing", ACCUMULATORS: "Accumulators", UTILIZATION_MGMT: "Utilization mgmt",
  CARE_MGMT: "Care management", PROVIDER_DIRECTORY: "Provider directory", NETWORK_CONTRACTS: "Network contracts",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout({ title, description, body, current, noindex = true }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono&display=swap">
<link rel="stylesheet" href="/assets/site.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f2a44'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%23c7741b'/%3E%3C/svg%3E">
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/">Wellmark agent demos <small>by TVLSS</small></a>
  <nav class="nav" aria-label="Demos">${pages.map((p) => `<a href="/${p.id}"${p.id === current ? ' aria-current="page"' : ""}>${esc(p.nav)}</a>`).join("")}</nav>
</div></header>
${body}
<footer><div class="wrap">
  <p>Independent demonstration built by TVLSS to show how each assistant would work. Not affiliated with, endorsed by, or connected to Wellmark. Every member, employer, provider, claim and dollar amount on this site is fictional. Conversations are not stored.</p>
  <p>Built on AWS serverless in us-east-2: S3, CloudFront, Lambda, and Claude on Amazon Bedrock. <a href="/">All demos</a></p>
</div></footer>
</body>
</html>`;
}

function demoPage(p) {
  const agent = agents[p.id];
  if (!agent) throw new Error(`No agent ${p.id}`);
  const sys = [...new Set(agent.tools.map((t) => t.system))];
  const body = `
<main class="wrap">
  <div class="demo-head">
    <div><h1>${esc(p.h1)}</h1><p>${esc(p.tagline)}</p></div>
    <div class="signed"><b>${esc(p.persona)}</b>signed in · synthetic data</div>
  </div>
  <div class="demo">
    <section class="panel chat" data-agent="${p.id}" data-greeting="${esc(p.greeting)}" aria-label="Chat with the ${esc(agent.title.toLowerCase())}">
      <div class="chat-tools"><span>${esc(agent.title)}</span><button type="button">Start over</button></div>
      <div class="transcript" aria-live="polite"><div class="msg agent">${esc(p.greeting)}</div></div>
      <div class="samples" aria-label="Sample questions">${p.samples.map((s) => `<button type="button">${esc(s)}</button>`).join("")}</div>
      <form class="composer"><label class="visually-hidden" for="q" hidden>Your question</label><textarea id="q" rows="1" placeholder="Ask about ${esc(p.placeholder)}" autocomplete="off"></textarea><button class="btn" type="submit">Send</button></form>
    </section>
    <aside class="panel ledger" aria-label="System calls">
      <div class="ledger-head"><h3>What the agent did</h3><span></span></div>
      <div class="entries"><div class="empty">System calls the agent makes will appear here as they happen.</div></div>
      <div class="systems-list"><h4>Systems this agent can reach</h4>${sys.map((s) => `<span class="chip" data-system="${s}">${esc(SYSTEM_NAMES[s] ?? s)}</span>`).join("")}</div>
    </aside>
  </div>
  <section class="about">
    <div class="cols">
      <div>
        <h2>What this demo shows</h2>
        ${p.about.map((t) => `<p>${t}</p>`).join("")}
        <h3>What it would take for real</h3>
        <ul>${p.real.map((t) => `<li>${t}</li>`).join("")}</ul>
      </div>
      <div>
        <h2>Tools the agent has</h2>
        <p>Each tool is one function that reads a synthetic copy of one system. Swapping the synthetic copy for a real adapter is the integration work; the agent, prompt and page do not change.</p>
        <div class="table-wrap"><table class="tools-table"><thead><tr><th>Tool</th><th>System</th><th>Does</th></tr></thead><tbody>
        ${agent.tools.map((t) => `<tr><td><code>${t.name}</code>${t.kind === "write" ? '<br><span class="w">writes · asks first</span>' : ""}</td><td>${esc(SYSTEM_NAMES[t.system] ?? t.system)}</td><td>${esc(t.description.replace(/^WRITES:\s*/, ""))}</td></tr>`).join("")}
        </tbody></table></div>
      </div>
    </div>
  </section>
</main>
<script src="/assets/chat.js" defer></script>`;
  return layout({ title: `${p.nav} · Wellmark agent demos`, description: p.tagline, body, current: p.id });
}

function homePage() {
  const body = `
<main class="wrap">
  <section class="hero">
    <h1>${home.h1}</h1>
    <p class="lede">${home.lede}</p>
    <p class="meta">${home.meta}</p>
  </section>
  <section class="switchboard" aria-label="Demos">
    ${pages.map((p) => `<div class="row">
      <div><h3><a href="/${p.id}">${esc(p.nav)}</a></h3><p class="job">${esc(p.job)}</p><p class="systems">${[...new Set(agents[p.id].tools.map((t) => SYSTEM_NAMES[t.system] ?? t.system))].join(" · ")}</p></div>
      <p class="ask">${esc(p.samples[0])}</p>
      <a class="btn" href="/${p.id}">Try it</a>
    </div>`).join("")}
  </section>
</main>
<section class="band"><div class="wrap cols">
  <div>
    <h2>How it's built</h2>
    <p>${home.how}</p>
    ${archSvg()}
  </div>
  <div>
    <h2>The numbers that matter</h2>
    <ul class="facts">${home.facts.map(([k, v]) => `<li><b>${esc(k)}</b><span>${v}</span></li>`).join("")}</ul>
  </div>
</div></section>`;
  return layout({ title: "Wellmark agent demos", description: home.lede, body, current: null });
}

function archSvg() {
  return `<svg class="arch" viewBox="0 0 560 250" role="img" aria-label="Browser to CloudFront, then to S3 for pages or to a Lambda function that calls Claude on Bedrock and the system adapters">
  <rect x="8" y="20" width="96" height="40" rx="4"/><text x="56" y="45" text-anchor="middle">Browser</text>
  <line x1="104" y1="40" x2="150" y2="40"/>
  <rect x="150" y="20" width="110" height="40" rx="4"/><text x="205" y="45" text-anchor="middle">CloudFront</text>
  <path d="M260 40 H300 V110 H330"/><path d="M260 40 H330"/>
  <rect x="330" y="20" width="110" height="40" rx="4"/><text x="385" y="45" text-anchor="middle">S3 pages</text>
  <rect x="330" y="90" width="110" height="40" rx="4" class="hot"/><text x="385" y="115" text-anchor="middle">Lambda agent</text>
  <text x="385" y="146" text-anchor="middle" class="lbl">TypeScript · streaming</text>
  <path d="M385 130 V160"/>
  <rect x="300" y="160" width="170" height="40" rx="4"/><text x="385" y="185" text-anchor="middle">Claude on Bedrock</text>
  <path d="M330 110 H290 V215 H8"/>
  <rect x="8" y="200" width="80" height="34" rx="4"/><text x="48" y="222" text-anchor="middle">Claims</text>
  <rect x="98" y="200" width="90" height="34" rx="4"/><text x="143" y="222" text-anchor="middle">Membership</text>
  <rect x="198" y="200" width="82" height="34" rx="4"/><text x="239" y="222" text-anchor="middle">…13 more</text>
  <text x="8" y="188" class="lbl">System adapters (synthetic today)</text>
</svg>`;
}

for (const p of pages) writeFileSync(path.join(out, `${p.id}.html`), demoPage(p));
writeFileSync(path.join(out, "index.html"), homePage());
writeFileSync(path.join(out, "404.html"), layout({ title: "Not found · Wellmark agent demos", description: "Page not found", current: null, body: `<main class="wrap"><section class="hero"><h1>That page isn't here.</h1><p class="lede">Pick a demo from the menu, or <a href="/">start at the front</a>.</p></section></main>` }));
writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
console.log(`built ${pages.length + 2} pages -> site/`);
