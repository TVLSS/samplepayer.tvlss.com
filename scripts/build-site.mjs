// Generates site/ from site-src/. Page copy lives in site-src/pages.mjs; tool
// tables and system chips are read from the agent definitions in api/src so
// the pages can't drift from the code. Plain Node, no dependencies beyond
// esbuild (already an api devDependency).
import { createRequire } from "node:module";
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { pages, home } from "../site-src/pages.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { build } = createRequire(path.join(root, "api/package.json"))("esbuild");
const out = path.join(root, "site");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "site-src/assets"), path.join(out, "assets"), { recursive: true });
// Browsers cache /assets for a day (deploy.sh), so every reference carries the file's content
// hash; a changed file gets a new URL and the old cached copy is never used again.
const asset = (name) => `/assets/${name}?v=${createHash("sha256").update(readFileSync(path.join(root, "site-src/assets", name))).digest("hex").slice(0, 10)}`;

await build({ entryPoints: [path.join(root, "api/src/agents/index.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(root, "api/dist/site-agents.js"), target: "node22", logLevel: "silent" });
const { agents } = await import(pathToFileURL(path.join(root, "api/dist/site-agents.js")));

const SYSTEM_NAMES = {
  MEDICAL_CORE: "Medical core", DENTAL_ADMIN: "Dental admin", VISION_PARTNER: "Vision vendor", PBM: "Pharmacy (PBM)", SPENDING_ACCOUNTS: "FSA / HSA",
  MEMBERSHIP: "Membership", GROUP_ADMIN: "Group admin", BILLING: "Billing", ACCUMULATORS: "Accumulators", UTILIZATION_MGMT: "Utilization mgmt",
  CARE_MGMT: "Care management", PROVIDER_DIRECTORY: "Provider directory", NETWORK_CONTRACTS: "Network contracts",
};

const ICONS = {
  benefits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  claims: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  membership: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.2"/><path d="M6 17c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14 10h4M14 14h4"/></svg>',
  group: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/></svg>',
  accumulations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.4"/></svg>',
  "health-services": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M6 12h3l1.5-3 2 6 1.5-3h4"/></svg>',
  "provider-network": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6-5.2 6-11a6 6 0 0 0-12 0c0 5.8 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
};

function idCard(p) {
  if (p.id === "group") return `<div class="idcard" aria-label="Group account card, synthetic">
    <div class="plan"><span>Group account <small>Prairie Health Plans</small></span><span class="tag">SYNTHETIC</span></div>
    <div class="name">Cedar Rapids Machine Works</div>
    <dl><dt>Group</dt><dd>G-44812</dd><dt>Administrator</dt><dd>R. Castillo</dd><dt>Renewal</dt><dd>01/01/2027</dd><dt>Enrolled</dt><dd>183 subscribers</dd></dl></div>`;
  return `<div class="idcard" aria-label="Member ID card, synthetic">
    <div class="plan"><span>Prairie PPO 1500</span><span class="tag">SYNTHETIC</span><span class="chip" aria-hidden="true"></span></div>
    <div class="name">Dana Whitfield</div>
    <dl><dt>Member ID</dt><dd>W20419873</dd><dt>Group</dt><dd>G-44812</dd><dt>PCP copay</dt><dd>$25</dd><dt>Rx BIN</dt><dd>610014</dd></dl></div>`;
}

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
<link rel="stylesheet" href="${asset("fonts.css")}">
<link rel="stylesheet" href="${asset("site.css")}">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230f2a44'/%3E%3Ccircle cx='16' cy='16' r='6' fill='%23c7741b'/%3E%3C/svg%3E">
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>Wellmark agent demos <small>by TVLSS</small></a>
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
    <div><div class="icon" aria-hidden="true">${ICONS[p.id]}</div><h1>${esc(p.h1)}</h1><p>${esc(p.tagline)}</p></div>
    ${idCard(p)}
  </div>
  <div class="demo">
    <section class="panel chat" data-agent="${p.id}" data-greeting="${esc(p.greeting)}" aria-label="Chat with the ${esc(agent.title.toLowerCase())}">
      <div class="chat-tools"><b><i aria-hidden="true"></i>${esc(agent.title)} · signed in as ${esc(p.persona.split(" ·")[0])}</b><span class="budget" title="Estimated model spend today against the demo cap"></span><button type="button">Start over</button></div>
      <div class="transcript" aria-live="polite"><div class="msg agent">${esc(p.greeting)}</div></div>
      <div class="samples" aria-label="Sample questions">${p.samples.map((s) => `<button type="button">${esc(s)}</button>`).join("")}</div>
      <form class="composer"><label class="visually-hidden" for="q" hidden>Your question</label><textarea id="q" rows="1" placeholder="Ask about ${esc(p.placeholder)}" autocomplete="off"></textarea><button class="btn" type="submit">Send</button></form>
    </section>
    <aside class="panel ledger" aria-label="System calls">
      <div class="ledger-head"><h3>Live system calls</h3><span></span></div>
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
<script src="${asset("chat.js")}" defer></script>`;
  return layout({ title: `${p.nav} · Wellmark agent demos`, description: p.tagline, body, current: p.id });
}

function homePage() {
  const body = `
<main class="wrap">
  <section class="hero">
    <div>
      <div class="eyebrow"><i aria-hidden="true"></i>Live demos · synthetic data · nothing stored</div>
      <h1>${home.h1}</h1>
      <p class="lede">${home.lede}</p>
      <p class="meta">${home.meta}</p>
      <div class="cta"><a class="btn" href="/claims">Try the claims assistant</a><a class="btn ghost" href="#demos">See all seven</a></div>
    </div>
    <div class="specimen" aria-label="Example conversation with the accumulations assistant, played automatically">
      <div class="glass spec-chat"><div class="bar"><b>Accumulations assistant</b><span>signed in as Dana Whitfield</span></div><div class="spec-flow"></div></div>
      <div class="glass spec-ledger"><div class="bar"><b>Live system calls</b></div>
        <div class="row"><span class="dot"></span><div><div class="name">get_family_accumulators</div><div class="sys">accumulator service</div><div class="res"></div></div></div>
        <div class="row"><span class="dot"></span><div><div class="name">estimate_member_cost</div><div class="sys">accumulator service</div><div class="res"></div></div></div>
      </div>
    </div>
  </section>
  <section class="section" id="demos">
    <div class="section-head"><div><h2>Seven assistants, one pattern.</h2><p>Each reads a different set of back-office systems. Open one and ask it anything a member or an administrator would.</p></div></div>
    <div class="grid">
    ${pages.map((p, i) => `<a class="agent-card${i === pages.length - 1 ? " wide" : ""}" href="/${p.id}">
      <span class="n">0${i + 1}</span>
      <div class="icon" aria-hidden="true">${ICONS[p.id]}</div>
      <h3>${esc(p.nav)}</h3>
      <p class="job">${esc(p.job)}</p>
      <p class="ask">${esc(p.samples[0])}</p>
      <div class="foot"><span>${[...new Set(agents[p.id].tools.map((t) => SYSTEM_NAMES[t.system] ?? t.system))].join(" · ")}</span><b>Try it</b></div>
    </a>`).join("")}
    </div>
  </section>
</main>
<section class="band section"><div class="wrap cols">
  <div>
    <h2>How it's built</h2>
    <p>${home.how}</p>
    <div class="flow">
      <div class="node">Browser<small>static page</small></div>
      <div class="node">CloudFront<small>one domain</small></div>
      <div class="node hot">Lambda agent<small>TypeScript · streaming</small></div>
      <div class="node hot">Claude<small>Amazon Bedrock</small></div>
      <div class="node">Adapters<small>one per system</small></div>
      <div class="sys-row"><span>Medical core</span><span>Claims</span><span>Membership</span><span>Group admin</span><span>Billing</span><span>Accumulators</span><span>Utilization mgmt</span><span>Care mgmt</span><span>Provider directory</span><span>Contracts</span><span>Dental</span><span>Vision</span><span>PBM</span></div>
    </div>
  </div>
  <div>
    <h2>The numbers that matter</h2>
    <ul class="facts">${home.facts.map(([k, v]) => `<li><b>${esc(k)}</b><span>${v}</span></li>`).join("")}</ul>
  </div>
</div></section>
<script src="${asset("hero.js")}" defer></script>`;
  return layout({ title: "Wellmark agent demos", description: home.lede, body, current: null });
}

for (const p of pages) writeFileSync(path.join(out, `${p.id}.html`), demoPage(p));
writeFileSync(path.join(out, "index.html"), homePage());
writeFileSync(path.join(out, "404.html"), layout({ title: "Not found · Wellmark agent demos", description: "Page not found", current: null, body: `<main class="wrap"><section class="hero"><h1>That page isn't here.</h1><p class="lede">Pick a demo from the menu, or <a href="/">start at the front</a>.</p></section></main>` }));
writeFileSync(path.join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
console.log(`built ${pages.length + 2} pages -> site/`);
