import type { AgentDef, Tool } from "../types.js";
import { priorAuths, carePrograms, programEnrollments, nurseLine, plans, familyIds, members, accumulators, claims } from "../data.js";
import { baseRules, MEMBER_PERSONA } from "./common.js";

const fam = new Set<string>(familyIds);
const who = (id: unknown) => (typeof id === "string" && fam.has(id.toUpperCase()) ? id.toUpperCase() : "W20419873");
const paRules: { pattern: RegExp; service: string; required: boolean; note: string }[] = [
  { pattern: /mri|ct scan|\bct\b|pet scan|imaging/i, service: "Advanced imaging", required: true, note: "Ordering provider submits; usual decision in 2 business days" },
  { pattern: /physical therapy|\bpt\b|therapy visits/i, service: "Physical therapy", required: true, note: "Required after 12 visits per plan year; first 12 need no authorization" },
  { pattern: /inpatient|hospital stay|admission|surgery/i, service: "Inpatient admission", required: true, note: "Facility submits at least 5 days before elective admission; emergencies are notified within 48 hours" },
  { pattern: /sleep study/i, service: "Sleep study", required: true, note: "Ordering provider submits with symptoms and screening results" },
  { pattern: /x-ray|xray|lab|blood test|office visit|checkup|physical|urgent care|flu shot|vaccine|immunization|mammogram|colonoscopy/i, service: "Routine and preventive care", required: false, note: "No prior authorization" },
  { pattern: /ozempic|humira|trulicity|specialty/i, service: "Specialty or step-therapy drug", required: true, note: "Prescriber submits to the pharmacy benefit manager" },
];

const tools: Tool[] = [
  {
    name: "list_prior_auths", system: "UTILIZATION_MGMT", kind: "read",
    description: "Lists prior authorization requests for the member and dependents with status, decision dates and validity windows.",
    input_schema: { type: "object", properties: { member_id: { type: "string" } }, additionalProperties: false },
    run: (i) => priorAuths.filter((p) => fam.has(p.memberId) && (!i.member_id || p.memberId === who(i.member_id))).map((p) => ({ ...p, patient: members[p.memberId as keyof typeof members].name })),
  },
  {
    name: "check_prior_auth_required", system: "UTILIZATION_MGMT", kind: "read",
    description: "Checks whether a described service needs prior authorization under the plan and who submits it.",
    input_schema: { type: "object", properties: { service_description: { type: "string", description: "e.g. 'MRI of the knee', 'sleep study', 'physical therapy'" } }, required: ["service_description"], additionalProperties: false },
    run: (i) => { const s = String(i.service_description ?? ""); const rule = paRules.find((r) => r.pattern.test(s)); const pt = accumulators.W20419873.ptVisits; return rule ? { service: rule.service, priorAuthRequired: rule.required, note: rule.note, ...(rule.service === "Physical therapy" ? { visitsUsedThisYear: pt.used, threshold: pt.priorAuthAfter } : {}), planList: plans.PPO1500.priorAuthRequired } : { service: s, priorAuthRequired: "Unknown", note: "Not on the standard list; the provider can call to verify", planList: plans.PPO1500.priorAuthRequired }; },
  },
  {
    name: "list_care_programs", system: "CARE_MGMT", kind: "read",
    description: "Lists care management programs the plan offers, with eligibility, cost share and whether the member is enrolled. Flags programs the member appears eligible for based on recent claims.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => { const hasMsk = claims.some((c) => c.memberId === "W20419873" && /Orthopedics|Physical Therapy/.test(c.provider)); return carePrograms.map((p) => ({ ...p, enrolled: programEnrollments.some((e) => e.programId === p.programId && e.memberId === "W20419873"), likelyEligible: p.programId === "MSK" ? hasMsk : ["TOB", "BH"].includes(p.programId) })); },
  },
  {
    name: "enroll_in_program", system: "CARE_MGMT", kind: "write",
    description: "WRITES: enrolls the member in a care management program. Confirm the program with the member before calling.",
    input_schema: { type: "object", properties: { program_id: { type: "string", enum: ["MSK", "DIAB", "MAT", "TOB", "BH"] } }, required: ["program_id"], additionalProperties: false },
    run: (i) => { const p = carePrograms.find((p) => p.programId === i.program_id); if (!p) return { error: "Unknown program" }; programEnrollments.push({ memberId: "W20419873", programId: p.programId, enrolledDate: "2026-09-10", status: "Enrolled" }); return { program: p.name, status: "Enrolled", enrolledDate: "2026-09-10", nextStep: "A program coordinator calls within 2 business days to schedule the first session", summary: `Enrolled in ${p.name}`, note: "Demo only: nothing was actually enrolled." }; },
  },
  {
    name: "get_nurse_line", system: "CARE_MGMT", kind: "read",
    description: "Returns the 24/7 nurse line and telehealth options with cost share.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ({ nurseLine, telehealth: { copay: plans.PPO1500.copays.telehealth, note: "Virtual urgent care visits through the plan's telehealth partner, 24/7" }, urgentCareCopay: plans.PPO1500.copays.urgentCare, emergencyCopay: plans.PPO1500.copays.emergency }),
  },
  {
    name: "request_prior_auth_status_update", system: "UTILIZATION_MGMT", kind: "write",
    description: "WRITES: asks the utilization management team to expedite or give a status update on a pending prior authorization. Confirm with the member before calling.",
    input_schema: { type: "object", properties: { auth_id: { type: "string" }, reason: { type: "string" } }, required: ["auth_id"], additionalProperties: false },
    run: (i) => { const pa = priorAuths.find((p) => p.authId.toUpperCase() === String(i.auth_id).toUpperCase().trim()); if (!pa) return { error: `No authorization ${i.auth_id}` }; if (pa.decision !== "Pending clinical review") return { authId: pa.authId, decision: pa.decision, summary: "Already decided; nothing to expedite" }; return { authId: pa.authId, ticket: `UM-${Date.now().toString().slice(-5)}`, status: "Escalated to clinical reviewer", expectedBy: "2026-09-11", summary: "Status update requested", note: "Demo only." }; },
  },
];

export const healthServices: AgentDef = {
  id: "health-services",
  title: "Health services assistant",
  persona: MEMBER_PERSONA,
  tools,
  system: baseRules({
    role: "the health services assistant",
    who: "Dana Whitfield, member ID W20419873, on the Prairie PPO 1500 plan, with spouse Marcus (W20419874) and daughter Ava (W20419875) covered.",
    scope: "You help with prior authorizations, care management programs, the nurse line and telehealth. You explain what needs approval and how to get it; you do not judge whether care is needed.",
    extra: "If the member describes symptoms, do not assess them. Acknowledge briefly, give the nurse line, and answer the coverage question. If Dana asks about knee pain, physical therapy or the MSK program together, it is fine to point out she looks eligible for the back and joint care program, which has no cost share.",
  }),
};
