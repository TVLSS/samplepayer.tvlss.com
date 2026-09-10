// Runs one question against each agent straight through the runtime (no Lambda),
// printing the ledger and timing. Usage: node scripts/smoke.mjs [agentId ...]
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
await build({ entryPoints: ["src/runtime.ts", "src/agents/index.ts"], bundle: true, platform: "node", format: "esm", outdir: "dist/smoke", target: "node22", external: ["@aws-sdk/*", "@smithy/*"] });
const { runTurn } = await import(pathToFileURL("dist/smoke/runtime.js"));
const { agents } = await import(pathToFileURL("dist/smoke/agents/index.js"));
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
for (const id of ids) {
  const t0 = Date.now();
  let text = ""; let calls = 0; let firstText = 0;
  process.stdout.write(`\n=== ${id}: ${questions[id]}\n`);
  await runTurn(agents[id], [{ role: "user", content: questions[id] }], (e) => {
    if (e.type === "text") { if (!firstText) firstText = Date.now() - t0; text += e.delta; }
    if (e.type === "tool_call") { calls++; process.stdout.write(`  -> ${e.name} ${JSON.stringify(e.input)}\n`); }
    if (e.type === "tool_result") process.stdout.write(`  <- ${e.name}: ${e.summary} (${e.ms}ms)\n`);
    if (e.type === "done") process.stdout.write(`  [${e.stopReason}] ${Date.now() - t0}ms total, first text at ${firstText}ms, ${calls} tool calls in ${e.rounds} model calls, tokens in=${e.usage.inputTokens} cached=${e.usage.cacheReadInputTokens} out=${e.usage.outputTokens} model=${e.model}\n`);
    if (e.type === "error") process.stdout.write(`  !! ${e.message}\n`);
  });
  process.stdout.write("\n" + text.trim().split("\n").map((l) => "  | " + l).join("\n") + "\n");
}
