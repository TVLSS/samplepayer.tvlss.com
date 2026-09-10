// Per-turn mutable state. Everything a "write" tool changes lives here, and a
// fresh copy is made for every request, so one visitor's typed-in address or
// appeal reason can never surface in another visitor's conversation. The Lambda
// itself holds nothing between requests; the browser keeps the transcript.
//
// The trade-off is deliberate: a change made in one turn is not visible in the
// next. Tools return the change in their result, the model repeats it in the
// answer, and that answer is in the history the browser sends back.

import { members, group } from "./data.js";

export interface TurnState {
  members: typeof members;
  group: typeof group;
  appeals: { appealId: string; claimId: string; reason: string; filed: string; status: string }[];
  requests: Record<string, unknown>[];
  changes: Record<string, unknown>[];
  programEnrollments: { memberId: string; programId: string; enrolledDate: string; status: string }[];
}

export function newTurnState(): TurnState {
  return { members: structuredClone(members), group: structuredClone(group), appeals: [], requests: [], changes: [], programEnrollments: [] };
}
