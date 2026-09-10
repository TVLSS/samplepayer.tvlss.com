import type { AgentDef, Tool } from "../types.js";
import { providers, contracts, plans, estimateCostShare } from "../data.js";
import { baseRules, MEMBER_PERSONA } from "./common.js";

const NETWORK = plans.PPO1500.network;
/** True when every meaningful word in the query ("Dr. Lindqvist", "Hana Lindqvist") appears in the provider name. */
function nameMatches(providerName: string, query: string): boolean {
  const words = query.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter((w) => w && !["dr", "doctor", "md", "do"].includes(w));
  const hay = providerName.toLowerCase();
  return words.length > 0 && words.every((w) => hay.includes(w));
}

const tools: Tool[] = [
  {
    name: "search_providers", system: "PROVIDER_DIRECTORY", kind: "read",
    description: "Searches the provider directory by specialty and optional filters: city, in-network only, accepting new patients, telehealth, gender, language. Returns providers sorted by distance from the member's home in Cedar Rapids.",
    input_schema: { type: "object", properties: { specialty: { type: "string", description: "e.g. Dermatology, Physical Therapy, Family Medicine, Urgent Care, Cardiology, Psychiatry, General Dentistry, Optometry, Hospital" }, city: { type: "string" }, in_network_only: { type: "boolean" }, accepting_new_patients: { type: "boolean" }, telehealth: { type: "boolean" }, gender: { type: "string", enum: ["F", "M"] }, language: { type: "string" } }, additionalProperties: false },
    run: (i) => { const spec = String(i.specialty ?? "").toLowerCase(); return providers.filter((p) => !spec || p.specialty.toLowerCase().includes(spec) || spec.includes(p.specialty.toLowerCase()) || (spec.includes("dermat") && p.specialty === "Dermatology") || (spec.includes("physical") && p.specialty === "Physical Therapy") || (spec.includes("pcp") && ["Family Medicine", "Pediatrics"].includes(p.specialty))).filter((p) => !i.city || p.address.toLowerCase().includes(String(i.city).toLowerCase())).filter((p) => i.in_network_only === undefined || i.in_network_only === false || p.networks.includes(NETWORK) || p.networks.some((n) => /Dental|Vision/.test(n))).filter((p) => i.accepting_new_patients === undefined || p.acceptingNewPatients === i.accepting_new_patients).filter((p) => i.telehealth === undefined || p.telehealth === i.telehealth).filter((p) => !i.gender || p.gender === i.gender).filter((p) => !i.language || p.languages.some((l) => l.toLowerCase() === String(i.language).toLowerCase())).sort((a, b) => a.distanceMiles - b.distanceMiles).map((p) => ({ npi: p.npi, name: p.name, specialty: p.specialty, practice: p.practice, address: p.address, phone: p.phone, inNetwork: p.networks.includes(NETWORK) || p.networks.some((n) => /Dental|Vision/.test(n)), tier: p.tier, acceptingNewPatients: p.acceptingNewPatients, telehealth: p.telehealth, distanceMiles: p.distanceMiles, nextAvailable: p.nextAvailable, qualityRating: p.qualityRating })); },
  },
  {
    name: "check_network_status", system: "NETWORK_CONTRACTS", kind: "read",
    description: "Checks whether a specific provider (by NPI or name) is in the member's network today, the tier, and any contract end date or continuity-of-care note.",
    input_schema: { type: "object", properties: { npi: { type: "string" }, name: { type: "string" } }, additionalProperties: false },
    run: (i) => { const p = providers.find((p) => (i.npi && p.npi === String(i.npi)) || (i.name && nameMatches(p.name, String(i.name)))); if (!p) return { error: `No provider matching ${i.npi ?? i.name}` }; const c = contracts.find((c) => c.npi === p.npi); const inNet = p.networks.includes(NETWORK) || p.networks.some((n) => /Dental|Vision/.test(n)); return { npi: p.npi, name: p.name, specialty: p.specialty, inNetwork: inNet, networks: p.networks, tier: p.tier, contract: c ?? { status: inNet ? "Active" : "Not contracted" }, summary: inNet ? `In network (${p.networks.join(", ")})` : "Out of network" }; },
  },
  {
    name: "get_provider", system: "PROVIDER_DIRECTORY", kind: "read",
    description: "Returns full directory details for one provider by NPI: address, phone, languages, telehealth, new-patient status, next available appointment and quality rating.",
    input_schema: { type: "object", properties: { npi: { type: "string" } }, required: ["npi"], additionalProperties: false },
    run: (i) => providers.find((p) => p.npi === String(i.npi)) ?? { error: `No provider with NPI ${i.npi}` },
  },
  {
    name: "compare_in_vs_out_of_network_cost", system: "MEDICAL_CORE", kind: "read",
    description: "Estimates the member's cost for a service at an in-network provider versus an out-of-network provider, given the expected allowed amount. Illustrates balance billing risk.",
    input_schema: { type: "object", properties: { allowed_amount: { type: "number" }, service_type: { type: "string", enum: ["pcp", "specialist", "urgentCare", "emergency", "other"] } }, required: ["allowed_amount", "service_type"], additionalProperties: false },
    run: (i) => { const inNet = estimateCostShare("W20419873", Number(i.allowed_amount), i.service_type as "other"); const oon = plans.PPO1500.outOfNetwork; const amt = Number(i.allowed_amount); const oonDeductibleRemaining = oon.deductible.individual; const applied = Math.min(amt, oonDeductibleRemaining); const coins = Math.round((amt - applied) * oon.coinsurance); return { inNetwork: inNet, outOfNetwork: { deductibleRemaining: oonDeductibleRemaining, appliedToDeductible: applied, coinsurance: coins, memberPays: applied + coins, balanceBilling: "The provider can also bill the difference between their charge and the plan's allowed amount", basis: `Separate $${oon.deductible.individual} out-of-network deductible (none met), then ${oon.coinsurance * 100}% coinsurance` } }; },
  },
  {
    name: "report_directory_error", system: "PROVIDER_DIRECTORY", kind: "write",
    description: "WRITES: reports an inaccuracy in the provider directory (wrong phone, not accepting patients, moved). Confirm the provider and the correction with the member before calling.",
    input_schema: { type: "object", properties: { npi: { type: "string" }, issue: { type: "string" } }, required: ["npi", "issue"], additionalProperties: false },
    run: (i) => { const p = providers.find((p) => p.npi === String(i.npi)); if (!p) return { error: "Unknown provider" }; return { ticket: `DIR-${Date.now().toString().slice(-5)}`, provider: p.name, issue: i.issue, status: "Sent to provider data team", verifiedWithin: "5 business days", summary: "Directory correction submitted", note: "Demo only." }; },
  },
];

export const providerNetwork: AgentDef = {
  id: "provider-network",
  title: "Provider network assistant",
  persona: MEMBER_PERSONA,
  tools,
  system: baseRules({
    role: "the provider network assistant",
    who: "Dana Whitfield, member ID W20419873, on the Prairie PPO 1500 plan (Prairie Choice PPO network), living in Cedar Rapids, Iowa.",
    scope: "You help her find in-network providers, confirm whether a specific provider is in network, understand what out-of-network care costs, and report directory errors.",
    extra: "Default to in-network results. When you list providers give name, specialty, distance, whether they accept new patients and next available date, at most five at a time. If a provider is leaving the network, say when and mention continuity-of-care. Never recommend one clinician over another on medical grounds; you can order by distance, availability or the directory's quality rating and say which you used.",
  }),
};
