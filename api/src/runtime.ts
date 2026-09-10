// Runs one agent turn against Amazon Bedrock's Converse streaming API and
// emits NDJSON events as they happen: text deltas, tool calls, tool results.
//
// Why Converse and not the Anthropic SDK: the Anthropic Bedrock (Mantle)
// endpoint in us-east-2 only lists Haiku 4.5 for this account; Converse
// serves Sonnet 5 and Opus 5 in the same region. Checked 2026-09-10.

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type ContentBlock,
  type Tool as BedrockTool,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import type { AgentDef, Tool } from "./types.js";
import { newTurnState } from "./state.js";

const REGION = process.env.AWS_REGION ?? "us-east-2";
const MODEL_ID = process.env.MODEL_ID ?? "us.anthropic.claude-sonnet-5";
const MAX_TOOL_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS ?? 8);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1200);
// Bedrock Guardrail (template.yaml). Empty id = off, which is what the in-process smoke script gets.
const GUARDRAIL_ID = process.env.GUARDRAIL_ID ?? "";
const GUARDRAIL_VERSION = process.env.GUARDRAIL_VERSION ?? "DRAFT";

const client = new BedrockRuntimeClient({ region: REGION });

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; system: string; kind: "read" | "write"; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; output: unknown; ms: number }
  | { type: "done"; stopReason: string; usage: { inputTokens: number; outputTokens: number }; model: string; budget?: { spent: number; cap: number } }
  | { type: "error"; message: string };

export interface ClientMessage { role: "user" | "assistant"; content: string }

export interface TurnOptions {
  /**
   * Called before every model call after the first (the caller reserves the
   * first one before streaming starts). Return false to stop the turn: the
   * budget is enforced per model call, not per turn, so a turn can never run
   * further than what has been reserved for it.
   */
  reserveCall?: () => Promise<boolean>;
}

export const BUDGET_STOP_TEXT = "\n\nThis demo has used its model budget for today, so I have to stop here. It resets at midnight UTC.";

function toBedrockTools(tools: Tool[]): BedrockTool[] {
  return tools.map((t) => ({ toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.input_schema as unknown as DocumentType } } }));
}

function summarize(output: unknown): string {
  if (Array.isArray(output)) return `${output.length} row${output.length === 1 ? "" : "s"}`;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.error === "string") return o.error;
    if (typeof o.summary === "string") return o.summary;
    const keys = Object.keys(o);
    return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ", …" : "");
  }
  return String(output);
}

export async function runTurn(agent: AgentDef, history: ClientMessage[], emit: (e: ChatEvent) => void | Promise<void>, opts: TurnOptions = {}): Promise<void> {
  const state = newTurnState();
  const toolsByName = new Map(agent.tools.map((t) => [t.name, t]));
  // Only the visitor's latest message is wrapped for input assessment; with a guardContent
  // block present the guardrail leaves earlier turns and tool results alone. Output is
  // assessed in async mode: text streams as the model produces it and the guardrail
  // replaces a chunk if it intervenes. Sync mode held the whole answer until assessed,
  // which doubled time-to-first-text (measured 2026-09-10); every block in the test set
  // happens on input anyway, and input assessment is identical in both modes.
  const messages: Message[] = history.map((m, i) => ({
    role: m.role,
    content: GUARDRAIL_ID && i === history.length - 1 ? [{ guardContent: { text: { text: m.content } } }] : [{ text: m.content }],
  }));
  let totalIn = 0;
  let totalOut = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    if (round > 0 && opts.reserveCall && !(await opts.reserveCall())) {
      emit({ type: "text", delta: BUDGET_STOP_TEXT });
      await emit({ type: "done", stopReason: "budget", usage: { inputTokens: totalIn, outputTokens: totalOut }, model: MODEL_ID });
      return;
    }
    const res = await client.send(
      new ConverseStreamCommand({
        modelId: MODEL_ID,
        system: [{ text: agent.system }],
        messages,
        toolConfig: { tools: toBedrockTools(agent.tools) },
        inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS },
        guardrailConfig: GUARDRAIL_ID ? { guardrailIdentifier: GUARDRAIL_ID, guardrailVersion: GUARDRAIL_VERSION, streamProcessingMode: "async" } : undefined,
      }),
    );
    if (!res.stream) throw new Error("Bedrock returned no stream");

    const assistantContent: ContentBlock[] = [];
    let stopReason = "end_turn";
    let currentTool: { id: string; name: string; json: string } | null = null;
    let currentText = "";

    for await (const ev of res.stream) {
      if (ev.contentBlockStart?.start?.toolUse) {
        const tu = ev.contentBlockStart.start.toolUse;
        currentTool = { id: tu.toolUseId ?? "", name: tu.name ?? "", json: "" };
      } else if (ev.contentBlockDelta?.delta) {
        const d = ev.contentBlockDelta.delta;
        if (d.text) { currentText += d.text; emit({ type: "text", delta: d.text }); }
        if (d.toolUse?.input && currentTool) currentTool.json += d.toolUse.input;
      } else if (ev.contentBlockStop) {
        if (currentTool) {
          let input: Record<string, unknown> = {};
          try { input = currentTool.json ? JSON.parse(currentTool.json) : {}; } catch { input = {}; }
          assistantContent.push({ toolUse: { toolUseId: currentTool.id, name: currentTool.name, input: input as unknown as DocumentType } });
          currentTool = null;
        } else if (currentText) {
          assistantContent.push({ text: currentText });
          currentText = "";
        }
      } else if (ev.messageStop) {
        stopReason = ev.messageStop.stopReason ?? "end_turn";
      } else if (ev.metadata?.usage) {
        totalIn += ev.metadata.usage.inputTokens ?? 0;
        totalOut += ev.metadata.usage.outputTokens ?? 0;
      }
    }
    if (currentText) assistantContent.push({ text: currentText });
    if (assistantContent.length) messages.push({ role: "assistant", content: assistantContent });

    const toolUses = assistantContent.filter((b) => b.toolUse).map((b) => b.toolUse!);
    if (stopReason !== "tool_use" || toolUses.length === 0) {
      await emit({ type: "done", stopReason, usage: { inputTokens: totalIn, outputTokens: totalOut }, model: MODEL_ID });
      return;
    }

    const results: ContentBlock[] = [];
    for (const tu of toolUses) {
      const tool = toolsByName.get(tu.name ?? "");
      const input = (tu.input ?? {}) as Record<string, unknown>;
      const id = tu.toolUseId ?? "";
      emit({ type: "tool_call", id, name: tu.name ?? "", system: tool?.system ?? "?", kind: tool?.kind ?? "read", input });
      const t0 = Date.now();
      let output: unknown;
      let ok = true;
      try {
        output = tool ? tool.run(input, state) : { error: `Unknown tool ${tu.name}` };
        if (!tool) ok = false;
      } catch (err) {
        ok = false;
        output = { error: err instanceof Error ? err.message : String(err) };
      }
      emit({ type: "tool_result", id, name: tu.name ?? "", ok, summary: summarize(output), output, ms: Date.now() - t0 });
      const jsonOut = Array.isArray(output) ? { results: output } : typeof output === "object" && output !== null ? output : { value: output };
      results.push({ toolResult: { toolUseId: id, content: [{ json: jsonOut as unknown as DocumentType }], status: ok ? "success" : "error" } });
    }
    messages.push({ role: "user", content: results });
  }
  emit({ type: "text", delta: "\n\nI stopped after several system lookups without reaching an answer. Try narrowing the question." });
  await emit({ type: "done", stopReason: "max_tool_rounds", usage: { inputTokens: totalIn, outputTokens: totalOut }, model: MODEL_ID });
}
