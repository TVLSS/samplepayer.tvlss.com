import type { AgentDef, Tool } from "../types.js";
import { members, familyIds, plans, dentalPlan, visionPlan, pharmacyBenefit, spendingAccounts, memberAccumulators, estimateCostShare } from "../data.js";
import { baseRules, MEMBER_PERSONA } from "./common.js";

const memberIdProp = { member_id: { type: "string", description: "Member ID, e.g. W20419873. Defaults to the signed-in member." } };
const fam = new Set<string>(familyIds);
const who = (id: unknown) => (typeof id === "string" && fam.has(id.toUpperCase()) ? id.toUpperCase() : "W20419873");

const tools: Tool[] = [
  {
    name: "list_connected_benefit_systems", system: "MEDICAL_CORE", kind: "read",
    description: "Lists the benefit systems this assistant is connected to and what each one answers. Use when the user asks what you can help with or which benefits you cover.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => [
      { system: "MEDICAL_CORE", covers: "Medical plan benefits: deductibles, copays, coinsurance, covered services, prior authorization rules", connected: "Original benefits chatbot scope" },
      { system: "DENTAL_ADMIN", covers: "Dental plan coverage levels, annual maximum, orthodontia", connected: "Added as an adapter" },
      { system: "VISION_PARTNER", covers: "Vision exam, frames and contacts allowances", connected: "Added as an adapter (vendor API)" },
      { system: "PBM", covers: "Pharmacy formulary tiers, copays, prior authorization, mail order", connected: "Added as an adapter" },
      { system: "SPENDING_ACCOUNTS", covers: "FSA and HSA elections and balances", connected: "Added as an adapter" },
    ],
  },
  {
    name: "get_medical_benefits", system: "MEDICAL_CORE", kind: "read",
    description: "Returns the member's medical plan design: deductible, out-of-pocket maximum, coinsurance, copays by visit type, out-of-network terms and services that need prior authorization.",
    input_schema: { type: "object", properties: { ...memberIdProp }, additionalProperties: false },
    run: (i) => { const m = members[who(i.member_id) as keyof typeof members]; return { member: m.name, ...plans[m.planId as keyof typeof plans] }; },
  },
  {
    name: "get_dental_benefits", system: "DENTAL_ADMIN", kind: "read",
    description: "Returns dental plan coverage (preventive, basic, major, orthodontia), the annual maximum and how much of it the member has used this year.",
    input_schema: { type: "object", properties: { ...memberIdProp }, additionalProperties: false },
    run: (i) => { const id = who(i.member_id); const a = memberAccumulators(id); return { member: members[id as keyof typeof members].name, ...(dentalPlan as Record<string, unknown>), usedThisYear: a.dental.used, remainingAnnualMax: a.dental.annualMax - a.dental.used }; },
  },
  {
    name: "get_vision_benefits", system: "VISION_PARTNER", kind: "read",
    description: "Returns vision benefits: exam copay and frequency, frames and contact lens allowances, and when the member last used them.",
    input_schema: { type: "object", properties: { ...memberIdProp }, additionalProperties: false },
    run: (i) => ({ member: members[who(i.member_id) as keyof typeof members].name, ...visionPlan, lastExam: "2025-10-03", lastFrames: "2024-11-19", framesEligibleAgain: "2026-11-19" }),
  },
  {
    name: "check_drug_coverage", system: "PBM", kind: "read",
    description: "Looks up a prescription drug on the formulary: tier, copay for 30 and 90 day supplies, whether prior authorization is required, and lower-cost alternatives.",
    input_schema: { type: "object", properties: { drug_name: { type: "string", description: "Drug name, brand or generic" } }, required: ["drug_name"], additionalProperties: false },
    run: (i) => {
      const key = String(i.drug_name ?? "").toLowerCase().trim();
      const hit = Object.entries(pharmacyBenefit.formulary).find(([k]) => key.includes(k) || k.includes(key));
      if (!hit) return { error: `${i.drug_name} is not on the formulary list I can see. A pharmacist can check coverage for unlisted drugs.` };
      const [name, f] = hit;
      const tier = pharmacyBenefit.tiers[f.tier as 1 | 2 | 3 | 4];
      return { drug: name, tier: f.tier, tierLabel: tier.label, cost: tier, priorAuthRequired: f.priorAuth, alternatives: f.alternatives, note: (f as { note?: string }).note ?? null, mailOrder: pharmacyBenefit.mailOrder };
    },
  },
  {
    name: "get_spending_accounts", system: "SPENDING_ACCOUNTS", kind: "read",
    description: "Returns FSA and HSA elections, balances, deadlines and card status for the member.",
    input_schema: { type: "object", properties: { ...memberIdProp }, additionalProperties: false },
    run: (i) => { const id = who(i.member_id); const s = (spendingAccounts as Record<string, unknown>)[id] as { fsa: unknown; hsa: unknown } | undefined; return s ? { member: members[id as keyof typeof members].name, ...s } : { member: members[id as keyof typeof members].name, fsa: null, hsa: null, note: "No spending accounts for this member" }; },
  },
  {
    name: "estimate_cost_for_service", system: "MEDICAL_CORE", kind: "read",
    description: "Estimates what the member will pay for an in-network service given its allowed amount, using current deductible and out-of-pocket accumulators. service_type 'other' applies deductible and coinsurance; the copay types apply a flat copay.",
    input_schema: { type: "object", properties: { ...memberIdProp, allowed_amount: { type: "number" }, service_type: { type: "string", enum: ["pcp", "specialist", "urgentCare", "emergency", "other"] } }, required: ["allowed_amount", "service_type"], additionalProperties: false },
    run: (i) => estimateCostShare(who(i.member_id), Number(i.allowed_amount), i.service_type as "other"),
  },
];

export const benefits: AgentDef = {
  id: "benefits",
  title: "Benefits assistant",
  persona: MEMBER_PERSONA,
  tools,
  system: baseRules({
    role: "the benefits assistant",
    who: "Dana Whitfield, member ID W20419873, subscriber on the Prairie PPO 1500 plan through her employer Cedar Rapids Machine Works. Her covered dependents are her spouse Marcus (W20419874) and daughter Ava (W20419875).",
    scope: "You answer questions about what her plan covers across medical, dental, vision, pharmacy and spending accounts. Each of those lives in a different back-office system and you have a tool for each.",
    extra: "When a question spans systems (for example 'what does a dental crown and a new pair of glasses cost me'), pull from each relevant system and combine the answer. If the user asks which systems you cover, list them from the tool rather than from memory.",
  }),
};
