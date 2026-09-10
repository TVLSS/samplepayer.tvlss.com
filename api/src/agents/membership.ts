import type { AgentDef, Tool } from "../types.js";
import { members, familyIds, plans, providers } from "../data.js";
import { baseRules, MEMBER_PERSONA } from "./common.js";

const fam = new Set<string>(familyIds);
const who = (id: unknown) => (typeof id === "string" && fam.has(id.toUpperCase()) ? id.toUpperCase() : "W20419873");
const requests: Record<string, unknown>[] = [];
const state = JSON.parse(JSON.stringify(members)) as typeof members;

const tools: Tool[] = [
  {
    name: "get_member", system: "MEMBERSHIP", kind: "read",
    description: "Returns the member's profile: name, date of birth, relationship, coverage status and dates, plan, group, contact details, primary care provider and when their ID card was last issued.",
    input_schema: { type: "object", properties: { member_id: { type: "string", description: "Defaults to the signed-in member" } }, additionalProperties: false },
    run: (i) => { const m = state[who(i.member_id) as keyof typeof state]; return { ...m, plan: plans[m.planId as keyof typeof plans].name }; },
  },
  {
    name: "list_dependents", system: "MEMBERSHIP", kind: "read",
    description: "Lists everyone covered under the subscriber's contract with relationship, date of birth and coverage status.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => familyIds.map((id) => { const m = state[id]; return { memberId: id, name: m.name, relationship: m.relationship, dob: m.dob, status: m.status, coverageStart: m.coverageStart, coverageEnd: m.coverageEnd }; }),
  },
  {
    name: "check_eligibility", system: "MEMBERSHIP", kind: "read",
    description: "Confirms whether a member is eligible for coverage on a given date, and on which plan.",
    input_schema: { type: "object", properties: { member_id: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD, defaults to today" } }, additionalProperties: false },
    run: (i) => { const m = state[who(i.member_id) as keyof typeof state]; const d = String(i.date ?? "2026-09-10"); const eligible = d >= m.coverageStart && (!m.coverageEnd || d <= m.coverageEnd); return { memberId: m.memberId, name: m.name, date: d, eligible, plan: plans[m.planId as keyof typeof plans].name, network: plans[m.planId as keyof typeof plans].network, summary: eligible ? "Eligible" : "Not eligible on that date" }; },
  },
  {
    name: "update_contact_info", system: "MEMBERSHIP", kind: "write",
    description: "WRITES: updates the subscriber's mailing address, phone or email. Applies to every family member on the contract. Confirm the new values with the member before calling.",
    input_schema: { type: "object", properties: { line1: { type: "string" }, city: { type: "string" }, state: { type: "string" }, zip: { type: "string" }, phone: { type: "string" }, email: { type: "string" } }, additionalProperties: false },
    run: (i) => { for (const id of familyIds) { const m = state[id]; if (i.line1 || i.city || i.state || i.zip) m.address = { line1: String(i.line1 ?? m.address.line1), city: String(i.city ?? m.address.city), state: String(i.state ?? m.address.state), zip: String(i.zip ?? m.address.zip) }; if (i.phone) m.phone = String(i.phone); if (i.email && id === "W20419873") m.email = String(i.email); } const r = { requestId: `REQ-${Date.now().toString().slice(-6)}`, applied: i, effective: "2026-09-10", summary: "Contact info updated for 3 members", note: "Demo only: nothing was actually changed." }; requests.push(r); return r; },
  },
  {
    name: "request_id_card", system: "MEMBERSHIP", kind: "write",
    description: "WRITES: orders a replacement ID card (mailed) or generates a digital card link. Confirm which member and which format before calling.",
    input_schema: { type: "object", properties: { member_id: { type: "string" }, format: { type: "string", enum: ["mail", "digital"] } }, required: ["format"], additionalProperties: false },
    run: (i) => { const m = state[who(i.member_id) as keyof typeof state]; const r = i.format === "digital" ? { requestId: `CARD-${m.memberId}-D`, member: m.name, format: "digital", link: `https://wellmark.tvlss.com/id-card/${m.memberId}`, summary: "Digital ID card ready", note: "Demo only." } : { requestId: `CARD-${m.memberId}-M`, member: m.name, format: "mail", mailingTo: m.address, arrives: "7 to 10 business days", summary: "Replacement card ordered", note: "Demo only: nothing was actually ordered." }; requests.push(r); return r; },
  },
  {
    name: "change_pcp", system: "MEMBERSHIP", kind: "write",
    description: "WRITES: changes a member's primary care provider to an in-network provider by NPI. Confirm the provider with the member before calling. Effective the first of next month.",
    input_schema: { type: "object", properties: { member_id: { type: "string" }, npi: { type: "string" } }, required: ["npi"], additionalProperties: false },
    run: (i) => { const p = providers.find((p) => p.npi === String(i.npi)); if (!p) return { error: `No provider with NPI ${i.npi}` }; if (!["Family Medicine", "Pediatrics", "Internal Medicine"].includes(p.specialty)) return { error: `${p.name} is ${p.specialty}; a PCP must be family medicine, internal medicine or pediatrics` }; const m = state[who(i.member_id) as keyof typeof state]; m.pcp = { npi: p.npi, name: p.name, practice: p.practice }; const r = { requestId: `PCP-${m.memberId}`, member: m.name, newPcp: m.pcp, effective: "2026-10-01", summary: `PCP changed to ${p.name}`, note: "Demo only." }; requests.push(r); return r; },
  },
  {
    name: "search_pcp_options", system: "PROVIDER_DIRECTORY", kind: "read",
    description: "Lists in-network primary care providers (family medicine, internal medicine, pediatrics) near the member, with whether they accept new patients.",
    input_schema: { type: "object", properties: { specialty: { type: "string", enum: ["Family Medicine", "Pediatrics", "Internal Medicine", "Any"] } }, additionalProperties: false },
    run: (i) => providers.filter((p) => ["Family Medicine", "Pediatrics", "Internal Medicine"].includes(p.specialty) && p.networks.includes("Prairie Choice PPO") && (!i.specialty || i.specialty === "Any" || p.specialty === i.specialty)).map((p) => ({ npi: p.npi, name: p.name, specialty: p.specialty, practice: p.practice, address: p.address, acceptingNewPatients: p.acceptingNewPatients, distanceMiles: p.distanceMiles, nextAvailable: p.nextAvailable })),
  },
  {
    name: "list_requests", system: "MEMBERSHIP", kind: "read",
    description: "Lists service requests made during this conversation.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => requests,
  },
];

export const membership: AgentDef = {
  id: "membership",
  title: "Membership assistant",
  persona: MEMBER_PERSONA,
  tools,
  system: baseRules({
    role: "the membership assistant",
    who: "Dana Whitfield, member ID W20419873, the subscriber. Her contract covers her spouse Marcus (W20419874) and daughter Ava (W20419875).",
    scope: "You handle membership questions and service requests: who is covered, eligibility, contact details, ID cards and primary care provider changes.",
    extra: "Read the current record before proposing a change so you can show the before and after. Address changes apply to the whole family; say so.",
  }),
};
