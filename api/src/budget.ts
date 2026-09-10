// Daily cap on estimated model spend, plus a per-IP fairness limit.
// Bedrock has no spend limit of its own, so the cap lives here: one DynamoDB
// item per UTC day holds the running estimated spend. Before EVERY model call
// (a turn makes up to MAX_TOOL_ROUNDS + 1 of them) the caller reserves that
// call's worst case with a conditional update; concurrent turns cannot push
// the total past the cap because the condition is checked atomically. When the
// turn ends the reservations are replaced by the measured token cost. If a
// turn dies mid-way (timeout, thrown error) the reservations stay as they are,
// which over-counts rather than under-counts.
//
// This bounds model spend only. Lambda, CloudFront, DynamoDB and log storage
// are outside it (they are fractions of a cent per turn, and reserved
// concurrency bounds them); the AWS Budget in template.yaml watches the bill.

import { DynamoDBClient, UpdateItemCommand, GetItemCommand, ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { createHash } from "node:crypto";

const TABLE = process.env.USAGE_TABLE ?? "";
const CAP = Number(process.env.DAILY_BUDGET_USD ?? 5);
const PRICE_IN = Number(process.env.PRICE_IN_PER_MTOK ?? 3);
const PRICE_OUT = Number(process.env.PRICE_OUT_PER_MTOK ?? 15);
const IP_TURNS_PER_HOUR = Number(process.env.IP_TURNS_PER_HOUR ?? 40);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS ?? 1200);
// Ceiling on one call's input: system prompt and tools (~3k tokens), trimmed
// history (16k chars, ~4k tokens) and up to eight rounds of tool results.
const RESERVE_INPUT_TOKENS = Number(process.env.RESERVE_INPUT_TOKENS ?? 20000);
const OVERHEAD = 0.0005; // Lambda + CloudFront + DynamoDB per turn, generous

/** Worst case for ONE model call at the assumed prices. RESERVE_USD overrides it. */
export const CALL_RESERVE = Number(process.env.RESERVE_USD || 0) || (RESERVE_INPUT_TOKENS * PRICE_IN + MAX_OUTPUT_TOKENS * PRICE_OUT) / 1e6 + OVERHEAD;

const ddb = new DynamoDBClient({});

export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

// Bedrock prices cached prefix tokens at 1.25x input for the write and 0.1x for reads.
export function turnCost(usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; cacheWriteInputTokens?: number }): number {
  const inTokens = usage.inputTokens + 1.25 * (usage.cacheWriteInputTokens ?? 0) + 0.1 * (usage.cacheReadInputTokens ?? 0);
  return (inTokens / 1e6) * PRICE_IN + (usage.outputTokens / 1e6) * PRICE_OUT + OVERHEAD;
}

export type Reservation = { ok: true; day: string } | { ok: false; status: number; message: string };

const CAP_MESSAGE = `This demo has used its $${CAP} budget for today. It resets at midnight UTC.`;

/** Reserve the worst case of one model call against today's cap. False when the cap is reached. */
export async function reserveCall(day: string): Promise<boolean> {
  if (!TABLE) return true;
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: TABLE, Key: { pk: { S: `day#${day}` } },
      UpdateExpression: "ADD spent :r, calls :one",
      ConditionExpression: "attribute_not_exists(spent) OR spent <= :limit",
      ExpressionAttributeValues: { ":r": { N: CALL_RESERVE.toFixed(6) }, ":one": { N: "1" }, ":limit": { N: (CAP - CALL_RESERVE).toFixed(6) } },
    }));
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/** Start of a turn: per-IP limit, then the first model call's reservation. */
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
  if (!(await reserveCall(day))) return { ok: false, status: 429, message: CAP_MESSAGE };
  await ddb.send(new UpdateItemCommand({ TableName: TABLE, Key: { pk: { S: `day#${day}` } }, UpdateExpression: "ADD turns :one", ExpressionAttributeValues: { ":one": { N: "1" } } }));
  return { ok: true, day };
}

/** Replace what the turn reserved with its measured cost. Returns today's running total. */
export async function settle(day: string, actualUsd: number, reservedUsd: number): Promise<number> {
  if (!TABLE) return 0;
  if (actualUsd > reservedUsd) console.warn(`budget: turn cost ${actualUsd.toFixed(4)} exceeded its reservation ${reservedUsd.toFixed(4)}; raise RESERVE_INPUT_TOKENS`);
  const res = await ddb.send(new UpdateItemCommand({
    TableName: TABLE, Key: { pk: { S: `day#${day}` } },
    UpdateExpression: "ADD spent :d", ExpressionAttributeValues: { ":d": { N: (actualUsd - reservedUsd).toFixed(6) } }, ReturnValues: "ALL_NEW",
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
