"""Runs one agent turn against Amazon Bedrock's Converse streaming API and yields
NDJSON-able events as they happen: text deltas, tool calls, tool results.
Mirrors api/src/runtime.ts; same event shapes, same wire protocol."""
from __future__ import annotations

import json
import os
import time
from typing import Any, Callable, Iterator

import boto3

from state import new_turn_state

REGION = os.environ.get("AWS_REGION", "us-east-2")
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-5")
MAX_TOOL_ROUNDS = int(os.environ.get("MAX_TOOL_ROUNDS", "8"))
MAX_OUTPUT_TOKENS = int(os.environ.get("MAX_OUTPUT_TOKENS", "1200"))
# Bedrock Guardrail (template.yaml). Empty id = off, which is what the in-process smoke script gets.
GUARDRAIL_ID = os.environ.get("GUARDRAIL_ID", "")
GUARDRAIL_VERSION = os.environ.get("GUARDRAIL_VERSION", "DRAFT")

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


BUDGET_STOP_TEXT = "\n\nThis demo has used its model budget for today, so I have to stop here. It resets at midnight UTC."


def run_turn(agent, history: list[dict[str, str]], reserve_call: Callable[[], bool] | None = None) -> Iterator[dict[str, Any]]:
    """reserve_call, if given, runs before every model call after the first (the
    caller reserves the first one before answering). Returning False stops the
    turn: the budget is enforced per model call, not per turn."""
    state = new_turn_state()
    tools_by_name = {t.name: t for t in agent.tools}
    # Only the visitor's latest message is wrapped for input assessment; with a guardContent
    # block present the guardrail leaves earlier turns and tool results alone. Output is
    # assessed in async mode, same as runtime.ts: sync mode held the whole answer until
    # assessed, and every block in the test set happens on input anyway.
    messages: list[dict[str, Any]] = [
        {"role": m["role"], "content": [{"guardContent": {"text": {"text": m["content"]}}}] if GUARDRAIL_ID and i == len(history) - 1 else [{"text": m["content"]}]}
        for i, m in enumerate(history)
    ]
    guard = {"guardrailConfig": {"guardrailIdentifier": GUARDRAIL_ID, "guardrailVersion": GUARDRAIL_VERSION, "streamProcessingMode": "async"}} if GUARDRAIL_ID else {}
    # Bedrock reports cached prefix tokens separately from inputTokens; both feed the cost estimate.
    usage = {"inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0, "cacheWriteInputTokens": 0}

    for round_ in range(MAX_TOOL_ROUNDS + 1):
        if round_ > 0 and reserve_call is not None and not reserve_call():
            yield {"type": "text", "delta": BUDGET_STOP_TEXT}
            yield {"type": "done", "stopReason": "budget", "usage": dict(usage), "model": MODEL_ID, "rounds": round_}
            return
        res = _client.converse_stream(
            modelId=MODEL_ID,
            # The cache point covers everything before it: the tool definitions and the system
            # prompt, about 1,900 tokens that never change between calls. Reads cost a tenth of
            # the input price and skip the prefill. Checked 2026-09-10 on this profile in us-east-2.
            system=[{"text": agent.system}, {"cachePoint": {"type": "default"}}],
            messages=messages,
            toolConfig={"tools": _bedrock_tools(agent)},
            inferenceConfig={"maxTokens": MAX_OUTPUT_TOKENS},
            **guard,
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
                for k in usage:
                    usage[k] += ev["metadata"]["usage"].get(k, 0)

        if current_text:
            assistant_content.append({"text": current_text})
        if assistant_content:
            messages.append({"role": "assistant", "content": assistant_content})

        tool_uses = [b["toolUse"] for b in assistant_content if "toolUse" in b]
        if stop_reason != "tool_use" or not tool_uses:
            yield {"type": "done", "stopReason": stop_reason, "usage": dict(usage), "model": MODEL_ID, "rounds": round_ + 1}
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
                output = tool.run(inp, state) if tool else {"error": f"Unknown tool {tu.get('name')}"}
                ok = tool is not None
            except Exception as err:  # noqa: BLE001 - a tool failure is reported to the model, not raised
                ok = False
                output = {"error": str(err)}
            yield {"type": "tool_result", "id": tid, "name": tu.get("name", ""), "ok": ok, "summary": _summarize(output), "output": output, "ms": int((time.time() - t0) * 1000)}
            json_out = {"results": output} if isinstance(output, list) else (output if isinstance(output, dict) else {"value": output})
            results.append({"toolResult": {"toolUseId": tid, "content": [{"json": json_out}], "status": "success" if ok else "error"}})
        messages.append({"role": "user", "content": results})

    yield {"type": "text", "delta": "\n\nI stopped after several system lookups without reaching an answer. Try narrowing the question."}
    yield {"type": "done", "stopReason": "max_tool_rounds", "usage": dict(usage), "model": MODEL_ID, "rounds": MAX_TOOL_ROUNDS + 1}
