// Renders pages at phone size (390x844, mobile emulation) through the local Chrome's
// DevTools protocol, prints layout measurements and saves full-page screenshots.
// Plain `chrome --headless --screenshot` will not do: it floors the window to a desktop
// minimum and crops. Usage:
//   node scripts/phone-check.mjs [outDir] [path ...]        default paths: / /claims /group
//   SITE_URL=http://localhost:8080 node scripts/phone-check.mjs
// macOS path to Chrome below; set CHROME to override.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SITE = process.env.SITE_URL ?? "https://wellmark.tvlss.com";
const [outDir = "phone-check", ...paths] = process.argv.slice(2);
const pages = paths.length ? paths : ["/", "/claims", "/group"];
const port = 9300 + Math.floor(Math.random() * 500);
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(outDir, ".chrome")}`, "about:blank"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const MEASURE = `(() => {
  const w = innerWidth;
  const box = (s) => { const e = document.querySelector(s); if (!e || getComputedStyle(e).display === "none") return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), height: Math.round(r.height) }; };
  const overflow = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest(".table-wrap, .nav, .samples"); }).slice(0, 8).map((e) => e.tagName.toLowerCase() + (e.className ? "." + String(e.className).trim().split(/\\s+/).slice(0, 2).join(".") : ""));
  const small = [...document.querySelectorAll("a, button")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height < 40; }).map((e) => e.textContent.trim().slice(0, 16) + ":" + Math.round(e.getBoundingClientRect().height));
  return { viewport: w + "x" + innerHeight, pageHeight: document.documentElement.scrollHeight, horizontalOverflow: overflow, header: box(".top"), chat: box(".chat"), transcript: box(".transcript"), ledger: box(".ledger"), idcard: box(".idcard"), tapTargetsUnder40px: small };
})()`;

const results = {};
for (const p of pages) {
  const target = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: SITE + p + (p.includes("?") ? "&" : "?") + "check=" + Date.now() });
  await new Promise((r) => setTimeout(r, 3000));
  const m = (await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true })).result.value;
  results[p] = m;
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 390, height: Math.min(m.pageHeight, 4000), scale: 1 } });
  const file = path.join(outDir, (p === "/" ? "home" : p.replace(/^\//, "").replace(/[^a-z0-9-]/gi, "_")) + ".png");
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  m.screenshot = file;
  ws.close();
}
chrome.kill();
console.log(JSON.stringify(results, null, 1));
const bad = Object.entries(results).filter(([, m]) => m.horizontalOverflow.length);
if (bad.length) { console.error("horizontal overflow on: " + bad.map(([p]) => p).join(", ")); process.exit(1); }
