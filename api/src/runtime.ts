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

const REGION = process.env.AWS_REGION ?? "us-east-2";
const MODEL_ID = process.env.MODEL_ID ?? "us.anthropic.claude-sonnet-5";
const MAX_TOOL_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS ?? 8);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1200);

const client = new BedrockRuntimeClient({ region: REGION });

export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; system: string; kind: "read" | "write"; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string; output: unknown; ms: number }
  | { type: "done"; stopReason: string; usage: { inputTokens: number; outputTokens: number }; model: string }
  | { type: "error"; message: string };

export interface ClientMessage { role: "user" | "assistant"; content: string }

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

export async function runTurn(agent: AgentDef, history: ClientMessage[], emit: (e: ChatEvent) => void): Promise<void> {
  const toolsByName = new Map(agent.tools.map((t) => [t.name, t]));
  const messages: Message[] = history.map((m) => ({ role: m.role, content: [{ text: m.content }] }));
  let totalIn = 0;
  let totalOut = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await client.send(
      new ConverseStreamCommand({
        modelId: MODEL_ID,
        system: [{ text: agent.system }],
        messages,
        toolConfig: { tools: toBedrockTools(agent.tools) },
        inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS },
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
      emit({ type: "done", stopReason, usage: { inputTokens: totalIn, outputTokens: totalOut }, model: MODEL_ID });
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
        output = tool ? tool.run(input) : { error: `Unknown tool ${tu.name}` };
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
  emit({ type: "done", stopReason: "max_tool_rounds", usage: { inputTokens: totalIn, outputTokens: totalOut }, model: MODEL_ID });
}
