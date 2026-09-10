// Hard daily spend cap and per-IP fairness limit, enforced before every turn.
// Bedrock has no spend limit of its own, so the cap lives here: one DynamoDB
// item per UTC day holds the running estimated spend; a turn first reserves an
// estimated cost with a conditional update (atomic, so concurrent turns cannot
// overshoot by more than their own reservations), then settles to the actual
// token cost when the turn finishes.

import { DynamoDBClient, UpdateItemCommand, GetItemCommand, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

const TABLE = process.env.USAGE_TABLE ?? "";
const CAP = Number(process.env.DAILY_BUDGET_USD ?? 5);
const PRICE_IN = Number(process.env.PRICE_IN_PER_MTOK ?? 3);
const PRICE_OUT = Number(process.env.PRICE_OUT_PER_MTOK ?? 15);
const RESERVE = Number(process.env.RESERVE_USD ?? 0.04);
const IP_TURNS_PER_HOUR = Number(process.env.IP_TURNS_PER_HOUR ?? 40);
const OVERHEAD = 0.0005; // Lambda + CloudFront + DynamoDB per turn, generous

const ddb = new DynamoDBClient({});

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export function turnCost(usage: { inputTokens: number; outputTokens: number }): number {
  return (usage.inputTokens / 1e6) * PRICE_IN + (usage.outputTokens / 1e6) * PRICE_OUT + OVERHEAD;
}

export type Reservation = { ok: true; day: string } | { ok: false; status: number; message: string };

export async function reserve(ip: string | undefined): Promise<Reservation> {
  if (!TABLE) return { ok: true, day: dayKey() };
  const day = dayKey();
  // Per-IP limit first: one bot must not spend everyone's day in three minutes.
  if (ip) {
    const hour = new Date().toISOString().slice(0, 13);
    const ipKey = `ip#${createHash("sha256").update(ip).digest("hex").slice(0, 16)}#${hour}`;
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: TABLE, Key: { pk: { S: ipKey } },
        UpdateExpression: "ADD turns :one SET #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(turns) OR turns < :max",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": { N: "1" }, ":max": { N: String(IP_TURNS_PER_HOUR) }, ":ttl": { N: String(Math.floor(Date.now() / 1000) + 7200) } },
      }));
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return { ok: false, status: 429, message: `That's a lot of questions from one place. This demo allows ${IP_TURNS_PER_HOUR} an hour per visitor; try again a little later.` };
      throw err;
    }
  }
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TABLE, Key: { pk: { S: `day#${day}` } },
      UpdateExpression: "ADD spent :r, turns :one",
      ConditionExpression: "attribute_not_exists(spent) OR spent <= :limit",
      ExpressionAttributeValues: { ":r": { N: String(RESERVE) }, ":one": { N: "1" }, ":limit": { N: String(CAP - RESERVE) } },
    }));
    return { ok: true, day };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return { ok: false, status: 429, message: `This demo has used its $${CAP} budget for today. It resets at midnight UTC.` };
    throw err;
  }
}

/** Replace the reservation with the real cost. Returns today's running total. */
export async function settle(day: string, actualUsd: number): Promise<number> {
  if (!TABLE) return 0;
  const res = await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: `day#${day}` } },
    UpdateExpression: "ADD spent :d", ExpressionAttributeValues: { ":d": { N: (actualUsd - RESERVE).toFixed(6) } }, ReturnValues: "ALL_NEW",
  }));
  return Number(res.Attributes?.spent?.N ?? 0);
}

export async function status(): Promise<{ day: string; spent: number; cap: number; remaining: number; turns: number }> {
  const day = dayKey();
  let spent = 0, turns = 0;
  if (TABLE) {
    const res = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { pk: { S: `day#${day}` } } }));
    spent = Number(res.Item?.spent?.N ?? 0); turns = Number(res.Item?.turns?.N ?? 0);
  }
  return { day, spent: Math.max(0, spent), cap: CAP, remaining: Math.max(0, CAP - spent), turns };
}
