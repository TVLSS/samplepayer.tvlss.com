"""Lambda entry point for the Python backend. Same routes and wire protocol as
api/src/handler.ts. Python's managed runtime cannot stream a Function URL
response natively, so this returns the whole NDJSON body at once (BUFFERED
mode); the browser client parses it line by line either way."""
from __future__ import annotations

import base64
import json
import re
from typing import Any

from agents import AGENTS
from runtime import run_turn
from budget import CALL_RESERVE, CAP, reserve, reserve_call, settle, status, turn_cost

MAX_TURNS = 24
MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_CHARS = 16000


def _json(status: int, body: Any) -> dict[str, Any]:
    return {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": "no-store"}, "body": json.dumps(body)}


def _validate(body: Any) -> tuple[str, list[dict[str, str]]] | str:
    if not isinstance(body, dict):
        return "Body must be a JSON object."
    agent = body.get("agent")
    if not isinstance(agent, str) or agent not in AGENTS:
        return f"Unknown agent. Expected one of: {', '.join(AGENTS)}."
    msgs = body.get("messages")
    if not isinstance(msgs, list) or not msgs:
        return "messages must be a non-empty array."
    out: list[dict[str, str]] = []
    for m in msgs:
        if not isinstance(m, dict) or m.get("role") not in ("user", "assistant") or not isinstance(m.get("content"), str):
            return "Each message needs role (user|assistant) and string content."
        if not m["content"].strip():
            return "Messages cannot be empty."
        if len(m["content"]) > MAX_MESSAGE_CHARS:
            return f"A message exceeds {MAX_MESSAGE_CHARS} characters."
        out.append({"role": m["role"], "content": m["content"]})
    if out[-1]["role"] != "user":
        return "The last message must be from the user."
    if out[0]["role"] != "user":
        return "The first message must be from the user."
    for i in range(1, len(out)):
        if out[i]["role"] == out[i - 1]["role"]:
            return "Messages must alternate user/assistant."
    trimmed = out[-MAX_TURNS:]
    while trimmed and trimmed[0]["role"] != "user":
        trimmed = trimmed[1:]
    while sum(len(m["content"]) for m in trimmed) > MAX_HISTORY_CHARS and len(trimmed) > 2:
        trimmed = trimmed[2:]
    return agent, trimmed


def _viewer_ip(event: dict[str, Any]) -> str | None:
    """The per-visitor limit is keyed on the viewer's address as CloudFront saw it.
    The CloudFront Function on /api/* sets x-viewer-ip from event.viewer.ip and
    overwrites any value the client sent. Anything in x-forwarded-for before the
    last entry is client-supplied (CloudFront appends the real viewer address at
    the end), so the fallback takes the last entry, never the first."""
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    trusted = (headers.get("x-viewer-ip") or "").strip()
    if trusted:
        return trusted
    xff = [p.strip() for p in (headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    return (xff[-1] if xff else None) or event.get("requestContext", {}).get("http", {}).get("sourceIp")


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    path = event.get("rawPath", "/")
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")

    if method == "GET" and path == "/api/agents":
        return _json(200, [{"id": a.id, "title": a.title, "persona": a.persona, "tools": [{"name": t.name, "system": t.system, "kind": t.kind, "description": t.description} for t in a.tools]} for a in AGENTS.values()])
    if method == "GET" and path == "/api/budget":
        return _json(200, status())
    if method != "POST" or path != "/api/chat":
        return _json(404, {"error": "Not found"})

    raw = event.get("body") or ""
    if event.get("isBase64Encoded"):
        raw = base64.b64decode(raw).decode("utf-8")
    try:
        parsed = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        return _json(400, {"error": "Body is not valid JSON."})
    v = _validate(parsed)
    if isinstance(v, str):
        return _json(400, {"error": v})
    agent_id, messages = v

    r = reserve(_viewer_ip(event))
    if not r["ok"]:
        return _json(r["status"], {"error": r["message"]})
    reserved = CALL_RESERVE

    def reserve_next() -> bool:
        nonlocal reserved
        ok = reserve_call(r["day"])
        if ok:
            reserved += CALL_RESERVE
        return ok

    lines: list[str] = []
    try:
        for ev in run_turn(AGENTS[agent_id], messages, reserve_next):
            if ev["type"] == "done":
                try:
                    ev["budget"] = {"spent": settle(r["day"], turn_cost(ev["usage"]), reserved), "cap": CAP}
                except Exception as err:  # noqa: BLE001
                    print("settle error", err)
            lines.append(json.dumps(ev))
    except Exception as err:  # noqa: BLE001
        msg = str(err)
        print("chat error", msg)
        friendly = "The model is busy right now. Try again in a few seconds." if re.search(r"ThrottlingException|TooManyRequests", msg) else "Something went wrong talking to the model. Try again."
        lines.append(json.dumps({"type": "error", "message": friendly}))
    return {"statusCode": 200, "headers": {"content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store"}, "body": "\n".join(lines) + "\n"}
