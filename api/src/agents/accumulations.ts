import type { AgentDef, Tool } from "../types.js";
import { accumulators, memberAccumulators, accumulatorHistory, familyIds, members, plans, estimateCostShare } from "../data.js";
import { baseRules, MEMBER_PERSONA } from "./common.js";

const fam = new Set<string>(familyIds);
const who = (id: unknown) => (typeof id === "string" && fam.has(id.toUpperCase()) ? id.toUpperCase() : "W20419873");
const plan = plans.PPO1500;

const tools: Tool[] = [
  {
    name: "get_member_accumulators", system: "ACCUMULATORS", kind: "read",
    description: "Returns one member's in-network accumulators for the plan year: deductible met and remaining, out-of-pocket met and remaining, dental annual maximum used, and physical therapy visits used against the prior-authorization threshold.",
    input_schema: { type: "object", properties: { member_id: { type: "string", description: "Defaults to the signed-in member" } }, additionalProperties: false },
    run: (i) => { const id = who(i.member_id); const a = memberAccumulators(id); return { memberId: id, name: members[id as keyof typeof members].name, planYear: 2026, deductible: { ...a.deductible, remaining: a.deductible.limit - a.deductible.met }, outOfPocket: { ...a.oop, remaining: a.oop.limit - a.oop.met }, dental: { ...a.dental, remaining: a.dental.annualMax - a.dental.used }, physicalTherapy: a.ptVisits }; },
  },
  {
    name: "get_family_accumulators", system: "ACCUMULATORS", kind: "read",
    description: "Returns the family-level deductible and out-of-pocket accumulators plus each member's contribution, and explains the embedded deductible rule.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ planYear: 2026, family: { deductible: { ...accumulators.family.deductible, remaining: accumulators.family.deductible.limit - accumulators.family.deductible.met }, outOfPocket: { ...accumulators.family.oop, remaining: accumulators.family.oop.limit - accumulators.family.oop.met } }, members: familyIds.map((id) => { const a = accumulators[id]; return { memberId: id, name: members[id].name, deductibleMet: a.deductible.met, oopMet: a.oop.met }; }), rule: "Embedded: each person stops paying deductible at $1,500 on their own, and the whole family stops once combined deductible reaches $3,000. Same pattern for out-of-pocket at $5,000 / $10,000." }),
  },
  {
    name: "get_accumulator_history", system: "ACCUMULATORS", kind: "read",
    description: "Lists every claim that moved an accumulator this plan year, in date order, with how much each applied to deductible and out-of-pocket. Optional member filter.",
    input_schema: { type: "object", properties: { member_id: { type: "string" } }, additionalProperties: false },
    run: (i) => accumulatorHistory.filter((h) => !i.member_id || h.memberId === who(i.member_id)).map((h) => ({ ...h, patient: members[h.memberId as keyof typeof members].name })),
  },
  {
    name: "estimate_member_cost", system: "ACCUMULATORS", kind: "read",
    description: "Estimates the member's share of an in-network service from its allowed amount, applying remaining deductible, coinsurance and the out-of-pocket cap. Use service_type 'other' for anything that is not a flat-copay visit.",
    input_schema: { type: "object", properties: { member_id: { type: "string" }, allowed_amount: { type: "number" }, service_type: { type: "string", enum: ["pcp", "specialist", "urgentCare", "emergency", "other"] } }, required: ["allowed_amount", "service_type"], additionalProperties: false },
    run: (i) => estimateCostShare(who(i.member_id), Number(i.allowed_amount), i.service_type as "other"),
  },
  {
    name: "get_plan_limits", system: "MEDICAL_CORE", kind: "read",
    description: "Returns the plan's deductible, out-of-pocket maximum, coinsurance and copays so accumulator numbers can be explained against them.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ plan: plan.name, deductible: plan.deductible, outOfPocketMax: plan.outOfPocketMax, coinsurance: plan.coinsurance, copays: plan.copays, outOfNetwork: plan.outOfNetwork, note: "Copays count toward the out-of-pocket maximum but not toward the deductible. Premiums and out-of-network balance bills count toward neither." }),
  },
];

export const accumulationsAgent: AgentDef = {
  id: "accumulations",
  title: "Accumulations assistant",
  persona: MEMBER_PERSONA,
  tools,
  system: baseRules({
    role: "the accumulations assistant",
    who: "Dana Whitfield, member ID W20419873, on the Prairie PPO 1500 plan, with spouse Marcus (W20419874) and daughter Ava (W20419875) on the same contract.",
    scope: "You explain where she stands against her deductible and out-of-pocket maximum, individually and as a family, what moved the numbers, and what an upcoming service is likely to cost her.",
    extra: "Always give met, limit and remaining together, for example '$1,120 met of $1,500, so $380 to go'. When estimating, show the arithmetic in one or two short lines. Mention the embedded family rule only when it changes the answer.",
  }),
};
