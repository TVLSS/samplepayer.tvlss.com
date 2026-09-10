"""Runs one agent turn against Amazon Bedrock's Converse streaming API and yields
NDJSON-able events as they happen: text deltas, tool calls, tool results.
Mirrors api/src/runtime.ts; same event shapes, same wire protocol."""
from __future__ import annotations

import json
import os
import time
from typing import Any, Iterator

import boto3

REGION = os.environ.get("AWS_REGION", "us-east-2")
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-5")
MAX_TOOL_ROUNDS = int(os.environ.get("MAX_TOOL_ROUNDS", "8"))
MAX_OUTPUT_TOKENS = int(os.environ.get("MAX_OUTPUT_TOKENS", "1200"))

_client = boto3.client("bedrock-runtime", region_name=REGION)


def _bedrock_tools(agent) -> list[dict[str, Any]]:
    return [{"toolSpec": {"name": t.name, "description": t.description, "inputSchema": {"json": t.input_schema}}} for t in agent.tools]


def _summarize(output: Any) -> str:
    if isinstance(output, list):
        return f"{len(output)} row{'' if len(output) == 1 else 's'}"
    if isinstance(output, dict):
        if isinstance(output.get("error"), str):
            return output["error"]
        if isinstance(output.get("summary"), str):
            return output["summary"]
        keys = list(output.keys())
        return ", ".join(keys[:4]) + (", …" if len(keys) > 4 else "")
    return str(output)


def run_turn(agent, history: list[dict[str, str]]) -> Iterator[dict[str, Any]]:
    tools_by_name = {t.name: t for t in agent.tools}
    messages: list[dict[str, Any]] = [{"role": m["role"], "content": [{"text": m["content"]}]} for m in history]
    total_in = total_out = 0

    for _round in range(MAX_TOOL_ROUNDS + 1):
        res = _client.converse_stream(
            modelId=MODEL_ID,
            system=[{"text": agent.system}],
            messages=messages,
            toolConfig={"tools": _bedrock_tools(agent)},
            inferenceConfig={"maxTokens": MAX_OUTPUT_TOKENS},
        )
        assistant_content: list[dict[str, Any]] = []
        stop_reason = "end_turn"
        current_tool: dict[str, str] | None = None
        current_text = ""

        for ev in res["stream"]:
            if "contentBlockStart" in ev and "toolUse" in ev["contentBlockStart"].get("start", {}):
                tu = ev["contentBlockStart"]["start"]["toolUse"]
                current_tool = {"id": tu.get("toolUseId", ""), "name": tu.get("name", ""), "json": ""}
            elif "contentBlockDelta" in ev:
                d = ev["contentBlockDelta"]["delta"]
                if "text" in d:
                    current_text += d["text"]
                    yield {"type": "text", "delta": d["text"]}
                if "toolUse" in d and current_tool is not None:
                    current_tool["json"] += d["toolUse"].get("input", "")
            elif "contentBlockStop" in ev:
                if current_tool is not None:
                    try:
                        inp = json.loads(current_tool["json"]) if current_tool["json"] else {}
                    except json.JSONDecodeError:
                        inp = {}
                    assistant_content.append({"toolUse": {"toolUseId": current_tool["id"], "name": current_tool["name"], "input": inp}})
                    current_tool = None
                elif current_text:
                    assistant_content.append({"text": current_text})
                    current_text = ""
            elif "messageStop" in ev:
                stop_reason = ev["messageStop"].get("stopReason", "end_turn")
            elif "metadata" in ev and "usage" in ev["metadata"]:
                total_in += ev["metadata"]["usage"].get("inputTokens", 0)
                total_out += ev["metadata"]["usage"].get("outputTokens", 0)

        if current_text:
            assistant_content.append({"text": current_text})
        if assistant_content:
            messages.append({"role": "assistant", "content": assistant_content})

        tool_uses = [b["toolUse"] for b in assistant_content if "toolUse" in b]
        if stop_reason != "tool_use" or not tool_uses:
            yield {"type": "done", "stopReason": stop_reason, "usage": {"inputTokens": total_in, "outputTokens": total_out}, "model": MODEL_ID}
            return

        results: list[dict[str, Any]] = []
        for tu in tool_uses:
            tool = tools_by_name.get(tu.get("name", ""))
            inp = tu.get("input") or {}
            tid = tu.get("toolUseId", "")
            yield {"type": "tool_call", "id": tid, "name": tu.get("name", ""), "system": tool.system if tool else "?", "kind": tool.kind if tool else "read", "input": inp}
            t0 = time.time()
            ok = True
            try:
                output = tool.run(inp) if tool else {"error": f"Unknown tool {tu.get('name')}"}
                ok = tool is not None
            except Exception as err:  # noqa: BLE001 - a tool failure is reported to the model, not raised
                ok = False
                output = {"error": str(err)}
            yield {"type": "tool_result", "id": tid, "name": tu.get("name", ""), "ok": ok, "summary": _summarize(output), "output": output, "ms": int((time.time() - t0) * 1000)}
            json_out = {"results": output} if isinstance(output, list) else (output if isinstance(output, dict) else {"value": output})
            results.append({"toolResult": {"toolUseId": tid, "content": [{"json": json_out}], "status": "success" if ok else "error"}})
        messages.append({"role": "user", "content": results})

    yield {"type": "text", "delta": "\n\nI stopped after several system lookups without reaching an answer. Try narrowing the question."}
    yield {"type": "done", "stopReason": "max_tool_rounds", "usage": {"inputTokens": total_in, "outputTokens": total_out}, "model": MODEL_ID}
