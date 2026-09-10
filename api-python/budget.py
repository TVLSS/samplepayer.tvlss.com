"""Hard daily spend cap and per-IP limit. Mirrors api/src/budget.ts exactly."""
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
RESERVE = float(os.environ.get("RESERVE_USD", "0.04"))
IP_TURNS_PER_HOUR = int(os.environ.get("IP_TURNS_PER_HOUR", "40"))
OVERHEAD = 0.0005

_ddb = boto3.client("dynamodb")


def day_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def turn_cost(usage: dict) -> float:
    return usage.get("inputTokens", 0) / 1e6 * PRICE_IN + usage.get("outputTokens", 0) / 1e6 * PRICE_OUT + OVERHEAD


def _conditional_failed(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException"


def reserve(ip: str | None) -> dict:
    """Returns {"ok": True, "day": ...} or {"ok": False, "status": 429, "message": ...}."""
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
    try:
        _ddb.update_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}, UpdateExpression="ADD spent :r, turns :one",
                         ConditionExpression="attribute_not_exists(spent) OR spent <= :limit",
                         ExpressionAttributeValues={":r": {"N": str(RESERVE)}, ":one": {"N": "1"}, ":limit": {"N": str(CAP - RESERVE)}})
        return {"ok": True, "day": day}
    except ClientError as err:
        if _conditional_failed(err):
            return {"ok": False, "status": 429, "message": f"This demo has used its ${CAP:g} budget for today. It resets at midnight UTC."}
        raise


def settle(day: str, actual_usd: float) -> float:
    if not TABLE:
        return 0.0
    res = _ddb.update_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}, UpdateExpression="ADD spent :d",
                           ExpressionAttributeValues={":d": {"N": f"{actual_usd - RESERVE:.6f}"}}, ReturnValues="ALL_NEW")
    return float(res.get("Attributes", {}).get("spent", {}).get("N", 0))


def status() -> dict:
    day = day_key()
    spent = turns = 0.0
    if TABLE:
        item = _ddb.get_item(TableName=TABLE, Key={"pk": {"S": f"day#{day}"}}).get("Item", {})
        spent = float(item.get("spent", {}).get("N", 0)); turns = float(item.get("turns", {}).get("N", 0))
    return {"day": day, "spent": max(0.0, spent), "cap": CAP, "remaining": max(0.0, CAP - spent), "turns": int(turns)}
