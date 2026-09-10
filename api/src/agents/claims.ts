import type { AgentDef, Tool } from "../types.js";
import { claims, familyIds, members, priorAuths } from "../data.js";
import { baseRules, MEMBER_PERSONA } from "./common.js";

const fam = new Set<string>(familyIds);

const tools: Tool[] = [
  {
    name: "find_claims", system: "MEDICAL_CORE", kind: "read",
    description: "Finds claims for the member and covered dependents. Filter by status (Processed, Pending, Denied), patient name, or service date range. Returns a summary per claim.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["Processed", "Pending", "Denied", "Any"] }, patient: { type: "string", description: "Patient first or last name" }, from_date: { type: "string", description: "YYYY-MM-DD" }, to_date: { type: "string", description: "YYYY-MM-DD" } }, additionalProperties: false },
    run: (i) => claims
      .filter((c) => fam.has(c.memberId))
      .filter((c) => !i.status || i.status === "Any" || c.status === i.status)
      .filter((c) => !i.patient || c.patient.toLowerCase().includes(String(i.patient).toLowerCase()))
      .filter((c) => !i.from_date || c.serviceDate >= String(i.from_date))
      .filter((c) => !i.to_date || c.serviceDate <= String(i.to_date))
      .map((c) => ({ claimId: c.claimId, patient: c.patient, serviceDate: c.serviceDate, provider: c.provider, type: c.type, status: c.status, billed: c.lines.reduce((n, l) => n + l.billed, 0), memberResponsibility: c.lines.reduce((n, l) => n + (l.memberResponsibility ?? 0), 0), pendingReason: (c as { pendingReason?: string }).pendingReason ?? null })),
  },
  {
    name: "get_claim", system: "MEDICAL_CORE", kind: "read",
    description: "Returns full detail for one claim: every line with billed, allowed, deductible, coinsurance, copay, plan paid and member responsibility, plus status, dates, denial reason and notes.",
    input_schema: { type: "object", properties: { claim_id: { type: "string", description: "e.g. CLM-26-004481" } }, required: ["claim_id"], additionalProperties: false },
    run: (i) => { const c = claims.find((c) => c.claimId.toUpperCase() === String(i.claim_id).toUpperCase().trim()); return c && fam.has(c.memberId) ? c : { error: `No claim ${i.claim_id} on this family's account` }; },
  },
  {
    name: "explain_denial", system: "MEDICAL_CORE", kind: "read",
    description: "For a denied claim, returns the denial reason code, plain-language explanation, what would make it payable, and the appeal deadline.",
    input_schema: { type: "object", properties: { claim_id: { type: "string" } }, required: ["claim_id"], additionalProperties: false },
    run: (i) => {
      const c = claims.find((c) => c.claimId.toUpperCase() === String(i.claim_id).toUpperCase().trim());
      if (!c || !fam.has(c.memberId)) return { error: `No claim ${i.claim_id}` };
      if (c.status !== "Denied") return { claimId: c.claimId, status: c.status, note: "This claim was not denied." };
      const d = c as typeof c & { denialCode: string; denialReason: string; appealDeadline: string };
      return { claimId: c.claimId, denialCode: d.denialCode, denialReason: d.denialReason, howToResolve: c.notes, appealDeadline: d.appealDeadline, options: ["Ask the provider to submit a retroactive prior authorization with clinical notes", "File a member appeal with a statement of medical necessity", "Ask the provider about their financial hardship policy"] };
    },
  },
  {
    name: "get_prior_auth_for_claim", system: "UTILIZATION_MGMT", kind: "read",
    description: "Checks whether a prior authorization exists for a claim's service and returns its decision and validity window.",
    input_schema: { type: "object", properties: { claim_id: { type: "string" } }, required: ["claim_id"], additionalProperties: false },
    run: (i) => { const c = claims.find((c) => c.claimId.toUpperCase() === String(i.claim_id).toUpperCase().trim()); if (!c) return { error: "Unknown claim" }; const pa = priorAuths.find((p) => p.authId === c.priorAuth); return pa ?? { claimId: c.claimId, priorAuth: null, summary: "No prior authorization on file for this service" }; },
  },
  {
    name: "get_eob", system: "MEDICAL_CORE", kind: "read",
    description: "Returns the Explanation of Benefits summary for a processed claim and a link the member can download it from.",
    input_schema: { type: "object", properties: { claim_id: { type: "string" } }, required: ["claim_id"], additionalProperties: false },
    run: (i) => { const c = claims.find((c) => c.claimId.toUpperCase() === String(i.claim_id).toUpperCase().trim()); if (!c || !fam.has(c.memberId)) return { error: "Unknown claim" }; if (!c.eobAvailable) return { claimId: c.claimId, eobAvailable: false, summary: "EOB is produced when the claim finishes processing" }; return { claimId: c.claimId, eobAvailable: true, downloadUrl: `https://wellmark.tvlss.com/eob/${c.claimId}.pdf`, issued: c.processedDate, totals: { billed: c.lines.reduce((n, l) => n + l.billed, 0), allowed: c.lines.reduce((n, l) => n + (l.allowed ?? 0), 0), planPaid: c.lines.reduce((n, l) => n + (l.planPaid ?? 0), 0), youOwe: c.lines.reduce((n, l) => n + (l.memberResponsibility ?? 0), 0) } }; },
  },
  {
    name: "file_appeal", system: "MEDICAL_CORE", kind: "write",
    description: "WRITES: files a first-level member appeal on a denied claim with the member's stated reason. Confirm with the member before calling. Returns an appeal ID and expected decision date.",
    input_schema: { type: "object", properties: { claim_id: { type: "string" }, reason: { type: "string", description: "The member's reason for appeal, in their words" } }, required: ["claim_id", "reason"], additionalProperties: false },
    run: (i, s) => { const c = claims.find((c) => c.claimId.toUpperCase() === String(i.claim_id).toUpperCase().trim()); if (!c || c.status !== "Denied") return { error: "Only denied claims can be appealed" }; const appealId = `APL-26-${String(7000 + s.appeals.length + 1)}`; s.appeals.push({ appealId, claimId: c.claimId, reason: String(i.reason), filed: "2026-09-10", status: "Received" }); return { appealId, claimId: c.claimId, status: "Received", filed: "2026-09-10", expectedDecisionBy: "2026-10-10", summary: `Appeal ${appealId} filed`, note: "Demo only: nothing was actually filed." }; },
  },
];

export const claimsAgent: AgentDef = {
  id: "claims",
  title: "Claims assistant",
  persona: MEMBER_PERSONA,
  tools,
  system: baseRules({
    role: "the claims assistant",
    who: `Dana Whitfield, member ID W20419873, subscriber on the Prairie PPO 1500 plan. Her covered dependents are her spouse Marcus (W20419874) and daughter Ava (W20419875). ${members.W20419873.name} can see the whole family's claims.`,
    scope: "You help her understand claim status, what she owes and why, why a claim was denied, and how to appeal. You can file an appeal for her once she confirms.",
    extra: "When explaining what a member owes, walk through allowed amount, then deductible, then coinsurance or copay, in that order, using the claim's own numbers. Explain 'allowed amount' the first time it comes up.",
  }),
};
