"""Runs one question against each agent straight through the runtime.
Usage (from repo root): .venv/bin/python api-python/scripts/smoke.py [agentId ...]"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agents import AGENTS  # noqa: E402
from runtime import run_turn  # noqa: E402

QUESTIONS = {
    "benefits": "What would a dental crown and a new pair of glasses cost me this year? And is Ozempic covered?",
    "claims": "Why was my physical therapy claim denied and what can I do about it?",
    "membership": "We moved to 812 Oakland Rd NE, Cedar Rapids 52402. Can you update that, and send Ava a new card?",
    "group": "What's our renewal looking like, and do we have anything unpaid?",
    "accumulations": "How close is my family to the deductible, and what would a $2,000 outpatient procedure cost me?",
    "health-services": "Does a sleep study need prior auth, and is there one pending for Marcus?",
    "provider-network": "I need a dermatologist who's taking new patients. Is Dr. Lindqvist still in network?",
}

ids = sys.argv[1:] or list(QUESTIONS)
for aid in ids:
    t0 = time.time()
    text, calls, first = "", 0, 0.0
    print(f"\n=== {aid}: {QUESTIONS[aid]}")
    for ev in run_turn(AGENTS[aid], [{"role": "user", "content": QUESTIONS[aid]}]):
        if ev["type"] == "text":
            first = first or time.time() - t0
            text += ev["delta"]
        elif ev["type"] == "tool_call":
            calls += 1
            print(f"  -> {ev['name']} {json.dumps(ev['input'])}")
        elif ev["type"] == "tool_result":
            print(f"  <- {ev['name']}: {ev['summary']} ({ev['ms']}ms)")
        elif ev["type"] == "done":
            print(f"  [{ev['stopReason']}] {int((time.time() - t0) * 1000)}ms total, first text at {int(first * 1000)}ms, {calls} tool calls in {ev['rounds']} model calls, tokens in={ev['usage']['inputTokens']} cached={ev['usage']['cacheReadInputTokens']} out={ev['usage']['outputTokens']} model={ev['model']}")
        elif ev["type"] == "error":
            print(f"  !! {ev['message']}")
    print("\n" + "\n".join("  | " + l for l in text.strip().split("\n")))
