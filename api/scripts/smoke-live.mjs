// Runs the same seven questions as smoke.mjs against the DEPLOYED site through
// CloudFront, so the signed Lambda URL, the edge function that stamps the viewer
// IP, the DynamoDB budget and the streaming path all get exercised. About seven
// turns (~17 cents) per run; use it after a deploy, not on a schedule.
// Usage: node scripts/smoke-live.mjs [agentId ...]   (SITE_URL overrides the target)
// Exits non-zero if any turn errors, is rate-limited, or stops for any reason other than end_turn.
import { createHash } from "node:crypto";

const SITE = process.env.SITE_URL ?? "https://wellmark.tvlss.com";
const questions = {
  benefits: "What would a dental crown and a new pair of glasses cost me this year? And is Ozempic covered?",
  claims: "Why was my physical therapy claim denied and what can I do about it?",
  membership: "We moved to 812 Oakland Rd NE, Cedar Rapids 52402. Can you update that, and send Ava a new card?",
  group: "What's our renewal looking like, and do we have anything unpaid?",
  accumulations: "How close is my family to the deductible, and what would a $2,000 outpatient procedure cost me?",
  "health-services": "Does a sleep study need prior auth, and is there one pending for Marcus?",
  "provider-network": "I need a dermatologist who's taking new patients. Is Dr. Lindqvist still in network?",
};
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(questions);
let failures = 0;

for (const id of ids) {
  const q = questions[id];
  if (!q) { process.stdout.write(`\n!! unknown agent ${id}\n`); failures++; continue; }
  const body = JSON.stringify({ agent: id, messages: [{ role: "user", content: q }] });
  const t0 = Date.now(); let text = ""; let calls = 0; let firstText = 0; let ok = false;
  process.stdout.write(`\n=== ${id}: ${q}\n`);
  let res;
  try {
    // CloudFront signs requests to the Lambda URL, so POST bodies must carry their own hash.
    res = await fetch(`${SITE}/api/chat`, { method: "POST", headers: { "content-type": "application/json", "x-amz-content-sha256": createHash("sha256").update(body).digest("hex") }, body });
  } catch (err) { process.stdout.write(`  !! ${err.message}\n`); failures++; continue; }
  if (!res.ok || !res.body) { process.stdout.write(`  !! HTTP ${res.status} ${await res.text()}\n`); failures++; continue; }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
  const handle = (e) => {
    if (e.type === "text") { if (!firstText) firstText = Date.now() - t0; text += e.delta; }
    if (e.type === "tool_call") { calls++; process.stdout.write(`  -> ${e.name} ${JSON.stringify(e.input)}\n`); }
    if (e.type === "tool_result") process.stdout.write(`  <- ${e.name}: ${e.summary} (${e.ms}ms)\n`);
    if (e.type === "done") { ok = e.stopReason === "end_turn"; process.stdout.write(`  [${e.stopReason}] ${Date.now() - t0}ms total, first text at ${firstText}ms, ${calls} tool calls, tokens in=${e.usage.inputTokens} out=${e.usage.outputTokens}, model=${e.model}${e.budget ? `, today $${e.budget.spent.toFixed(4)} of $${e.budget.cap}` : ""}\n`); }
    if (e.type === "error") process.stdout.write(`  !! ${e.message}\n`);
  };
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(JSON.parse(line)); }
  }
  if (buf.trim()) handle(JSON.parse(buf.trim()));
  if (!ok) failures++;
  process.stdout.write("\n" + text.trim().split("\n").map((l) => "  | " + l).join("\n") + "\n");
}
process.stdout.write(`\n${failures ? `${failures} of ${ids.length} turns failed` : `all ${ids.length} turns ok`}\n`);
process.exit(failures ? 1 : 0);
