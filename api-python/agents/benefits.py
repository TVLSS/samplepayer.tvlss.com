from agent_types import AgentDef, Tool
from data import MEMBERS, PLANS, DENTAL_PLAN, VISION_PLAN, PHARMACY_BENEFIT, SPENDING_ACCOUNTS, member_accumulators, estimate_cost_share
from agents.common import base_rules, who, MEMBER_PERSONA, MEMBER_ID_PROP


def _list_systems(_i):
    return [
        {"system": "MEDICAL_CORE", "covers": "Medical plan benefits: deductibles, copays, coinsurance, covered services, prior authorization rules", "connected": "Original benefits chatbot scope"},
        {"system": "DENTAL_ADMIN", "covers": "Dental plan coverage levels, annual maximum, orthodontia", "connected": "Added as an adapter"},
        {"system": "VISION_PARTNER", "covers": "Vision exam, frames and contacts allowances", "connected": "Added as an adapter (vendor API)"},
        {"system": "PBM", "covers": "Pharmacy formulary tiers, copays, prior authorization, mail order", "connected": "Added as an adapter"},
        {"system": "SPENDING_ACCOUNTS", "covers": "FSA and HSA elections and balances", "connected": "Added as an adapter"},
    ]


def _medical(i):
    m = MEMBERS[who(i.get("member_id"))]
    return {"member": m["name"], **PLANS[m["planId"]]}


def _dental(i):
    mid = who(i.get("member_id"))
    a = member_accumulators(mid)
    return {"member": MEMBERS[mid]["name"], **DENTAL_PLAN, "usedThisYear": a["dental"]["used"], "remainingAnnualMax": a["dental"]["annualMax"] - a["dental"]["used"]}


def _vision(i):
    return {"member": MEMBERS[who(i.get("member_id"))]["name"], **VISION_PLAN, "lastExam": "2025-10-03", "lastFrames": "2024-11-19", "framesEligibleAgain": "2026-11-19"}


def _drug(i):
    key = str(i.get("drug_name", "")).lower().strip()
    hit = next(((k, f) for k, f in PHARMACY_BENEFIT["formulary"].items() if k in key or key in k), None)
    if not hit:
        return {"error": f"{i.get('drug_name')} is not on the formulary list I can see. A pharmacist can check coverage for unlisted drugs."}
    name, f = hit
    tier = PHARMACY_BENEFIT["tiers"][f["tier"]]
    return {"drug": name, "tier": f["tier"], "tierLabel": tier["label"], "cost": tier, "priorAuthRequired": f["priorAuth"], "alternatives": f["alternatives"], "note": f.get("note"), "mailOrder": PHARMACY_BENEFIT["mailOrder"]}


def _spending(i):
    mid = who(i.get("member_id"))
    s = SPENDING_ACCOUNTS.get(mid)
    if s:
        return {"member": MEMBERS[mid]["name"], **s}
    return {"member": MEMBERS[mid]["name"], "fsa": None, "hsa": None, "note": "No spending accounts for this member"}


def _estimate(i):
    return estimate_cost_share(who(i.get("member_id")), float(i.get("allowed_amount", 0)), str(i.get("service_type", "other")))


tools = [
    Tool("list_connected_benefit_systems", "Lists the benefit systems this assistant is connected to and what each one answers. Use when the user asks what you can help with or which benefits you cover.", "MEDICAL_CORE", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _list_systems),
    Tool("get_medical_benefits", "Returns the member's medical plan design: deductible, out-of-pocket maximum, coinsurance, copays by visit type, out-of-network terms and services that need prior authorization.", "MEDICAL_CORE", "read", {"type": "object", "properties": {**MEMBER_ID_PROP}, "additionalProperties": False}, _medical),
    Tool("get_dental_benefits", "Returns dental plan coverage (preventive, basic, major, orthodontia), the annual maximum and how much of it the member has used this year.", "DENTAL_ADMIN", "read", {"type": "object", "properties": {**MEMBER_ID_PROP}, "additionalProperties": False}, _dental),
    Tool("get_vision_benefits", "Returns vision benefits: exam copay and frequency, frames and contact lens allowances, and when the member last used them.", "VISION_PARTNER", "read", {"type": "object", "properties": {**MEMBER_ID_PROP}, "additionalProperties": False}, _vision),
    Tool("check_drug_coverage", "Looks up a prescription drug on the formulary: tier, copay for 30 and 90 day supplies, whether prior authorization is required, and lower-cost alternatives.", "PBM", "read", {"type": "object", "properties": {"drug_name": {"type": "string", "description": "Drug name, brand or generic"}}, "required": ["drug_name"], "additionalProperties": False}, _drug),
    Tool("get_spending_accounts", "Returns FSA and HSA elections, balances, deadlines and card status for the member.", "SPENDING_ACCOUNTS", "read", {"type": "object", "properties": {**MEMBER_ID_PROP}, "additionalProperties": False}, _spending),
    Tool("estimate_cost_for_service", "Estimates what the member will pay for an in-network service given its allowed amount, using current deductible and out-of-pocket accumulators. service_type 'other' applies deductible and coinsurance; the copay types apply a flat copay.", "MEDICAL_CORE", "read", {"type": "object", "properties": {**MEMBER_ID_PROP, "allowed_amount": {"type": "number"}, "service_type": {"type": "string", "enum": ["pcp", "specialist", "urgentCare", "emergency", "other"]}}, "required": ["allowed_amount", "service_type"], "additionalProperties": False}, _estimate),
]

benefits = AgentDef(
    id="benefits", title="Benefits assistant", persona=MEMBER_PERSONA, tools=tools,
    system=base_rules(
        role="the benefits assistant",
        who="Dana Whitfield, member ID W20419873, subscriber on the Prairie PPO 1500 plan through her employer Cedar Rapids Machine Works. Her covered dependents are her spouse Marcus (W20419874) and daughter Ava (W20419875).",
        scope="You answer questions about what her plan covers across medical, dental, vision, pharmacy and spending accounts. Each of those lives in a different back-office system and you have a tool for each.",
        extra="When a question spans systems (for example 'what does a dental crown and a new pair of glasses cost me'), pull from each relevant system and combine the answer. If the user asks which systems you cover, list them from the tool rather than from memory.",
    ),
)
