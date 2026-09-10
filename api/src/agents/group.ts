import type { AgentDef, Tool } from "../types.js";
import { baseRules, GROUP_PERSONA } from "./common.js";


const tools: Tool[] = [
  {
    name: "get_group", system: "GROUP_ADMIN", kind: "read",
    description: "Returns the employer group's profile: contract dates, renewal date, eligibility rules, headcount, plans offered with employer contribution, ancillary lines, broker and open enrollment window.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (_i, s) => { const { invoices, renewal, pending, enrollmentByMonth, ...g } = s.group; return g; },
  },
  {
    name: "get_enrollment_summary", system: "GROUP_ADMIN", kind: "read",
    description: "Returns enrollment by plan, covered lives, participation rate, month-by-month subscriber counts and pending items (new hires awaiting enrollment, COBRA, terminations).",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (_i, s) => ({ eligibleEmployees: s.group.eligibleEmployees, enrolledSubscribers: s.group.enrolledSubscribers, participationRate: Math.round((s.group.enrolledSubscribers / s.group.eligibleEmployees) * 1000) / 10, totalCoveredLives: s.group.totalCoveredLives, byPlan: s.group.plans, enrollmentByMonth: s.group.enrollmentByMonth, pending: s.group.pending }),
  },
  {
    name: "get_renewal", system: "GROUP_ADMIN", kind: "read",
    description: "Returns the renewal proposal: proposed rate change, last year's change, cost drivers, alternative plan designs with their rate impact, and the decision deadline.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: (_i, s) => ({ renewalDate: s.group.renewalDate, ...s.group.renewal }),
  },
  {
    name: "list_invoices", system: "BILLING", kind: "read",
    description: "Lists group premium invoices with amount, due date and payment status.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["Open", "Paid", "Any"] } }, additionalProperties: false },
    run: (i, s) => s.group.invoices.filter((inv) => !i.status || i.status === "Any" || inv.status === i.status),
  },
  {
    name: "get_invoice_detail", system: "BILLING", kind: "read",
    description: "Breaks one invoice down by plan and coverage tier, and lists adjustments (new adds, terminations, retro changes).",
    input_schema: { type: "object", properties: { invoice_id: { type: "string" } }, required: ["invoice_id"], additionalProperties: false },
    run: (i, s) => { const inv = s.group.invoices.find((x) => x.invoiceId.toUpperCase() === String(i.invoice_id).toUpperCase().trim()); if (!inv) return { error: `No invoice ${i.invoice_id}` }; return { ...inv, lines: [{ plan: "Prairie PPO 1500", tier: "Employee", count: 48, rate: 612, amount: 29376 }, { plan: "Prairie PPO 1500", tier: "Employee + spouse", count: 31, rate: 1286, amount: 39866 }, { plan: "Prairie PPO 1500", tier: "Family", count: 42, rate: 1794, amount: 75348 }, { plan: "Prairie HDHP 3000", tier: "Employee", count: 29, rate: 498, amount: 14442 }, { plan: "Prairie HDHP 3000", tier: "Employee + spouse", count: 12, rate: 1046, amount: 12552 }, { plan: "Prairie HDHP 3000", tier: "Family", count: 21, rate: 1459, amount: 30639 }], adjustments: [{ type: "Retro termination", member: "K. Brandvold", effective: "2026-08-01", amount: -1286 }, { type: "New add", member: "T. Nguyen (family)", effective: "2026-09-01", amount: 1794 }], dental: 12405, vision: 2380 }; },
  },
  {
    name: "add_employee", system: "GROUP_ADMIN", kind: "write",
    description: "WRITES: enrolls a new employee (and dependents) in a plan effective on their eligibility date. Confirm name, hire date, plan and coverage tier with the administrator before calling.",
    input_schema: { type: "object", properties: { employee_name: { type: "string" }, hire_date: { type: "string", description: "YYYY-MM-DD" }, plan_id: { type: "string", enum: ["PPO1500", "HDHP3000"] }, coverage_tier: { type: "string", enum: ["Employee", "Employee + spouse", "Employee + children", "Family"] } }, required: ["employee_name", "hire_date", "plan_id", "coverage_tier"], additionalProperties: false },
    run: (i, s) => { const hire = new Date(String(i.hire_date) + "T00:00:00Z"); if (isNaN(hire.getTime())) return { error: "hire_date must be YYYY-MM-DD" }; const plus30 = new Date(hire.getTime() + 30 * 86400000); const eff = new Date(Date.UTC(plus30.getUTCFullYear(), plus30.getUTCMonth() + 1, 1)).toISOString().slice(0, 10); const r = { changeId: `ENR-${String(1000 + s.changes.length + 1)}`, employee: i.employee_name, plan: s.group.plans.find((p) => p.planId === i.plan_id)?.name, coverageTier: i.coverage_tier, hireDate: i.hire_date, effectiveDate: eff, summary: `${i.employee_name} enrolled effective ${eff}`, note: "Demo only: nothing was actually enrolled." }; s.changes.push(r); s.group.enrolledSubscribers += 1; return r; },
  },
  {
    name: "terminate_employee", system: "GROUP_ADMIN", kind: "write",
    description: "WRITES: terminates an employee's coverage at end of the month of their last day and triggers the COBRA notice. Confirm name and last day before calling.",
    input_schema: { type: "object", properties: { employee_name: { type: "string" }, last_day: { type: "string", description: "YYYY-MM-DD" } }, required: ["employee_name", "last_day"], additionalProperties: false },
    run: (i, s) => { const d = String(i.last_day); const end = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10); const r = { changeId: `TRM-${String(500 + s.changes.length + 1)}`, employee: i.employee_name, lastDay: d, coverageEnds: end, cobraNoticeMailed: "Within 14 days", summary: `${i.employee_name} coverage ends ${end}`, note: "Demo only." }; s.changes.push(r); return r; },
  },
];

export const groupAgent: AgentDef = {
  id: "group",
  title: "Group administrator assistant",
  persona: GROUP_PERSONA,
  tools,
  system: baseRules({
    role: "the employer group assistant",
    who: "Renee Castillo, HR Director at Cedar Rapids Machine Works (group G-44812), the group's benefits administrator. She is not a member; she administers the group.",
    scope: "You help her with the group's plans, enrollment, billing, renewal and employee changes. You never disclose an individual employee's claims or health information; you can only discuss enrollment and billing facts.",
    extra: "For renewal questions, give the numbers first and the drivers second, and lay out the alternatives side by side in a short list. Percentages as 6.8%.",
  }),
};
