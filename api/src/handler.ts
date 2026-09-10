// Lambda entry point. Served through a Function URL (RESPONSE_STREAM) behind
// CloudFront, so the browser sees /api/chat on the same origin as the site.
//
//   POST /api/chat   { agent: string, messages: [{role, content}] }  -> NDJSON stream
//   GET  /api/agents                                                  -> agent catalogue

import { agents } from "./agents/index.js";
import { runTurn, type ChatEvent, type ClientMessage } from "./runtime.js";
import { reserve, settle, status, turnCost } from "./budget.js";

declare const awslambda: {
  streamifyResponse: (fn: (event: LambdaUrlEvent, stream: ResponseStream, ctx: unknown) => Promise<void>) => unknown;
  HttpResponseStream: { from: (stream: ResponseStream, meta: { statusCode: number; headers: Record<string, string> }) => ResponseStream };
};
interface ResponseStream { write: (chunk: string) => void; end: () => void }
interface LambdaUrlEvent { rawPath?: string; headers?: Record<string, string>; requestContext?: { http?: { method?: string; sourceIp?: string } }; body?: string; isBase64Encoded?: boolean }

const MAX_TURNS = 24;
const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_CHARS = 16000;

function json(stream: ResponseStream, status: number, body: unknown) {
  const s = awslambda.HttpResponseStream.from(stream, { statusCode: status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  s.write(JSON.stringify(body));
  s.end();
}

function parseBody(event: LambdaUrlEvent): unknown {
  if (!event.body) return null;
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(raw);
}

function validate(body: unknown): { agentId: string; messages: ClientMessage[] } | string {
  if (!body || typeof body !== "object") return "Body must be a JSON object.";
  const b = body as Record<string, unknown>;
  if (typeof b.agent !== "string" || !(b.agent in agents)) return `Unknown agent. Expected one of: ${Object.keys(agents).join(", ")}.`;
  if (!Array.isArray(b.messages) || b.messages.length === 0) return "messages must be a non-empty array.";
  const messages: ClientMessage[] = [];
  for (const m of b.messages as unknown[]) {
    const mm = m as Record<string, unknown>;
    if ((mm.role !== "user" && mm.role !== "assistant") || typeof mm.content !== "string") return "Each message needs role (user|assistant) and string content.";
    if (!mm.content.trim()) return "Messages cannot be empty.";
    if (mm.content.length > MAX_MESSAGE_CHARS) return `A message exceeds ${MAX_MESSAGE_CHARS} characters.`;
    messages.push({ role: mm.role, content: mm.content });
  }
  if (messages[messages.length - 1].role !== "user") return "The last message must be from the user.";
  if (messages[0].role !== "user") return "The first message must be from the user.";
  for (let i = 1; i < messages.length; i++) if (messages[i].role === messages[i - 1].role) return "Messages must alternate user/assistant.";
  // Keep the demo cheap: trim to the most recent turns, keeping a user message first.
  let trimmed = messages.slice(-MAX_TURNS);
  while (trimmed.length && trimmed[0].role !== "user") trimmed = trimmed.slice(1);
  while (trimmed.reduce((n, m) => n + m.content.length, 0) > MAX_HISTORY_CHARS && trimmed.length > 2) trimmed = trimmed.slice(2);
  return { agentId: b.agent, messages: trimmed };
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const path = event.rawPath ?? "/";
  const method = event.requestContext?.http?.method ?? "GET";

  if (method === "GET" && path === "/api/agents") {
    return json(responseStream, 200, Object.values(agents).map((a) => ({ id: a.id, title: a.title, persona: a.persona, tools: a.tools.map((t) => ({ name: t.name, system: t.system, kind: t.kind, description: t.description })) })));
  }
  if (method === "GET" && path === "/api/budget") return json(responseStream, 200, await status());
  if (method !== "POST" || path !== "/api/chat") return json(responseStream, 404, { error: "Not found" });

  let parsed: unknown;
  try { parsed = parseBody(event); } catch { return json(responseStream, 400, { error: "Body is not valid JSON." }); }
  const v = validate(parsed);
  if (typeof v === "string") return json(responseStream, 400, { error: v });

  // CloudFront puts the viewer's address first in x-forwarded-for.
  const viewerIp = (event.headers?.["x-forwarded-for"] ?? "").split(",")[0].trim() || event.requestContext?.http?.sourceIp;
  const r = await reserve(viewerIp);
  if (!r.ok) return json(responseStream, r.status, { error: r.message });

  const stream = awslambda.HttpResponseStream.from(responseStream, { statusCode: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  const emit = (e: ChatEvent) => stream.write(JSON.stringify(e) + "\n");
  try {
    await runTurn(agents[v.agentId], v.messages, async (e) => {
      if (e.type === "done") {
        const spent = await settle(r.day, turnCost(e.usage)).catch(() => -1);
        emit({ ...e, budget: spent >= 0 ? { spent, cap: Number(process.env.DAILY_BUDGET_USD ?? 5) } : undefined });
      } else emit(e);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("chat error", message);
    emit({ type: "error", message: /ThrottlingException|TooManyRequests/.test(message) ? "The model is busy right now. Try again in a few seconds." : "Something went wrong talking to the model. Try again." });
  } finally {
    stream.end();
  }
});
