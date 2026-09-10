"""Daily cap on estimated model spend, plus a per-IP fairness limit. Mirrors
api/src/budget.ts exactly.

Before EVERY model call (a turn makes up to MAX_TOOL_ROUNDS + 1 of them) the
caller reserves that call's worst case with a conditional update; concurrent
turns cannot push the total past the cap because the condition is checked
atomically. When the turn ends the reservations are replaced by the measured
token cost. If a turn dies mid-way the reservations stay, which over-counts
rather than under-counts. This bounds model spend only; the AWS Budget in
template.yaml watches the bill."""
from __future__ import annotations

import hashlib
import os
import time
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

TABLE = os.environ.get("USAGE_TABLE", "")
CAP = float(os.environ.get("DAILY_BUDGET_USD", "5"))
PRICE_IN = float(os.environ.get("PRICE_IN_PER_MTOK", "3"))
PRICE_OUT = float(os.environ.get("PRICE_OUT_PER_MTOK", "15"))
IP_TURNS_PER_HOUR = int(os.environ.get("IP_TURNS_PER_HOUR", "40"))
MAX_OUTPUT_TOKENS = int(os.environ.get("MAX_OUTPUT_TOKENS", "1200"))
# Ceiling on one call's input: system prompt and tools (~3k tokens), trimmed
# history (16k chars, ~4k tokens) and up to eight rounds of tool results.
RESERVE_INPUT_TOKENS = int(os.environ.get("RESERVE_INPUT_TOKENS", "20000"))
OVERHEAD = 0.0005

# Worst case for ONE model call at the assumed prices. RESERVE_USD overrides it.
CALL_RESERVE = float(os.environ.get("RESERVE_USD") or 0) or (RESERVE_INPUT_TOKENS * PRICE_IN + MAX_OUTPUT_TOKENS * PRICE_OUT) / 1e6 + OVERHEAD
CAP_MESSAGE = f"This demo has used its ${CAP:g} budget for today. It resets at midnight UTC."

_ddb = boto3.client("dynamodb")


def day_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def turn_cost(usage: dict) -> float:
    # Bedrock prices cached prefix tokens at 1.25x input for the write and 0.1x for reads.
    in_tokens = usage.get("inputTokens", 0) + 1.25 * usage.get("cacheWriteInputTokens", 0) + 0.1 * usage.get("cacheReadInputTokens", 0)
    return in_tokens / 1e6 * PRICE_IN + usage.get("outputTokens", 0) / 1e6 * PRICE_OUT + OVERHEAD


def _conditional_failed(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def reserve_call(day: str) -> bool:
    """Reserve the worst case of one model call against today's cap. False when the cap is reached."""
    if not TABLE:
        return True
    try:
        _ddb.update_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}, UpdateExpression="ADD spent :r, calls :one",
                         ConditionExpression="attribute_not_exists(spent) OR spent <= :limit",
                         ExpressionAttributeValues={":r": {"N": f"{CALL_RESERVE:.6f}"}, ":one": {"N": "1"}, ":limit": {"N": f"{CAP - CALL_RESERVE:.6f}"}})
        return True
    except ClientError as err:
        if _conditional_failed(err):
            return False
        raise


def reserve(ip: str | None) -> dict:
    """Start of a turn: per-IP limit, then the first model call's reservation.
    Returns {"ok": True, "day": ...} or {"ok": False, "status": 429, "message": ...}."""
    if not TABLE:
        return {"ok": True, "day": day_key()}
    day = day_key()
    if ip:
        hour = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
        ip_key = f"ip#{hashlib.sha256(ip.encode()).hexdigest()[:16]}#{hour}"
        try:
            _ddb.update_item(TableName=TABLE, Key={"pk": {"S": ip_key}}, UpdateExpression="ADD turns :one SET #ttl = :ttl",
                             ConditionExpression="attribute_not_exists(turns) OR turns < :max", ExpressionAttributeNames={"#ttl": "ttl"},
                             ExpressionAttributeValues={":one": {"N": "1"}, ":max": {"N": str(IP_TURNS_PER_HOUR)}, ":ttl": {"N": str(int(time.time()) + 7200)}})
        except ClientError as err:
            if _conditional_failed(err):
                return {"ok": False, "status": 429, "message": f"That's a lot of questions from one place. This demo allows {IP_TURNS_PER_HOUR} an hour per visitor; try again a little later."}
            raise
    if not reserve_call(day):
        return {"ok": False, "status": 429, "message": CAP_MESSAGE}
    _ddb.update_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}, UpdateExpression="ADD turns :one", ExpressionAttributeValues={":one": {"N": "1"}})
    return {"ok": True, "day": day}


def settle(day: str, actual_usd: float, reserved_usd: float) -> float:
    """Replace what the turn reserved with its measured cost. Returns today's running total."""
    if not TABLE:
        return 0.0
    if actual_usd > reserved_usd:
        print(f"budget: turn cost {actual_usd:.4f} exceeded its reservation {reserved_usd:.4f}; raise RESERVE_INPUT_TOKENS")
    res = _ddb.update_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}, UpdateExpression="ADD spent :d",
                           ExpressionAttributeValues={":d": {"N": f"{actual_usd - reserved_usd:.6f}"}}, ReturnValues="ALL_NEW")
    return float(res.get("Attributes", {}).get("spent", {}).get("N", 0))


def status() -> dict:
    day = day_key()
    spent = turns = 0.0
    if TABLE:
        item = _ddb.get_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}).get("Item", {})
        spent = float(item.get("spent", {}).get("N", 0)); turns = float(item.get("turns", {}).get("N", 0))
    return {"day": day, "spent": max(0.0, spent), "cap": CAP, "remaining": max(0.0, CAP - spent), "turns": int(turns)}
