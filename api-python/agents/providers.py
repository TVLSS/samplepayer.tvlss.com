import re

from agent_types import AgentDef, Tool
from data import PROVIDERS, CONTRACTS, PLANS, estimate_cost_share
from agents.common import base_rules, MEMBER_PERSONA

_NETWORK = PLANS["PPO1500"]["network"]


def _name_matches(provider_name: str, query: str) -> bool:
    """True when every meaningful word in the query ("Dr. Lindqvist", "Hana Lindqvist") appears in the provider name."""
    words = [w for w in query.lower().replace(".", " ").replace(",", " ").split() if w not in ("dr", "doctor", "md", "do")]
    hay = provider_name.lower()
    return bool(words) and all(w in hay for w in words)


def _in_net(p):
    return _NETWORK in p["networks"] or any(re.search(r"Dental|Vision", n) for n in p["networks"])


def _search(i):
    spec = str(i.get("specialty") or "").lower()

    def spec_ok(p):
        s = p["specialty"].lower()
        return not spec or spec in s or s in spec or ("dermat" in spec and p["specialty"] == "Dermatology") or ("physical" in spec and p["specialty"] == "Physical Therapy") or ("pcp" in spec and p["specialty"] in ("Family Medicine", "Pediatrics"))

    rows = [p for p in PROVIDERS if spec_ok(p)
            and (not i.get("city") or str(i["city"]).lower() in p["address"].lower())
            and (not i.get("in_network_only") or _in_net(p))
            and (i.get("accepting_new_patients") is None or p["acceptingNewPatients"] == i["accepting_new_patients"])
            and (i.get("telehealth") is None or p["telehealth"] == i["telehealth"])
            and (not i.get("gender") or p["gender"] == i["gender"])
            and (not i.get("language") or any(l.lower() == str(i["language"]).lower() for l in p["languages"]))]
    rows.sort(key=lambda p: p["distanceMiles"])
    return [{"npi": p["npi"], "name": p["name"], "specialty": p["specialty"], "practice": p["practice"], "address": p["address"], "phone": p["phone"], "inNetwork": _in_net(p), "tier": p["tier"], "acceptingNewPatients": p["acceptingNewPatients"], "telehealth": p["telehealth"], "distanceMiles": p["distanceMiles"], "nextAvailable": p["nextAvailable"], "qualityRating": p["qualityRating"]} for p in rows]


def _status(i):
    p = next((p for p in PROVIDERS if (i.get("npi") and p["npi"] == str(i["npi"])) or (i.get("name") and _name_matches(p["name"], str(i["name"])))), None)
    if not p:
        return {"error": f"No provider matching {i.get('npi') or i.get('name')}"}
    c = next((c for c in CONTRACTS if c["npi"] == p["npi"]), None)
    in_net = _in_net(p)
    return {"npi": p["npi"], "name": p["name"], "specialty": p["specialty"], "inNetwork": in_net, "networks": p["networks"], "tier": p["tier"], "contract": c or {"status": "Active" if in_net else "Not contracted"}, "summary": f"In network ({', '.join(p['networks'])})" if in_net else "Out of network"}


def _get(i):
    return next((p for p in PROVIDERS if p["npi"] == str(i.get("npi"))), None) or {"error": f"No provider with NPI {i.get('npi')}"}


def _compare(i):
    amt = float(i.get("allowed_amount", 0))
    in_net = estimate_cost_share("W20419873", amt, str(i.get("service_type", "other")))
    oon = PLANS["PPO1500"]["outOfNetwork"]
    ded = oon["deductible"]["individual"]
    applied = min(amt, ded)
    coins = round((amt - applied) * oon["coinsurance"])
    return {"inNetwork": in_net, "outOfNetwork": {"deductibleRemaining": ded, "appliedToDeductible": applied, "coinsurance": coins, "memberPays": applied + coins, "balanceBilling": "The provider can also bill the difference between their charge and the plan's allowed amount", "basis": f"Separate ${ded} out-of-network deductible (none met), then {int(oon['coinsurance'] * 100)}% coinsurance"}}


def _report(i):
    p = next((p for p in PROVIDERS if p["npi"] == str(i.get("npi"))), None)
    if not p:
        return {"error": "Unknown provider"}
    return {"ticket": "DIR-48213", "provider": p["name"], "issue": i.get("issue"), "status": "Sent to provider data team", "verifiedWithin": "5 business days", "summary": "Directory correction submitted", "note": "Demo only."}


tools = [
    Tool("search_providers", "Searches the provider directory by specialty and optional filters: city, in-network only, accepting new patients, telehealth, gender, language. Returns providers sorted by distance from the member's home in Cedar Rapids.", "PROVIDER_DIRECTORY", "read", {"type": "object", "properties": {"specialty": {"type": "string", "description": "e.g. Dermatology, Physical Therapy, Family Medicine, Urgent Care, Cardiology, Psychiatry, General Dentistry, Optometry, Hospital"}, "city": {"type": "string"}, "in_network_only": {"type": "boolean"}, "accepting_new_patients": {"type": "boolean"}, "telehealth": {"type": "boolean"}, "gender": {"type": "string", "enum": ["F", "M"]}, "language": {"type": "string"}}, "additionalProperties": False}, _search),
    Tool("check_network_status", "Checks whether a specific provider (by NPI or name) is in the member's network today, the tier, and any contract end date or continuity-of-care note.", "NETWORK_CONTRACTS", "read", {"type": "object", "properties": {"npi": {"type": "string"}, "name": {"type": "string"}}, "additionalProperties": False}, _status),
    Tool("get_provider", "Returns full directory details for one provider by NPI: address, phone, languages, telehealth, new-patient status, next available appointment and quality rating.", "PROVIDER_DIRECTORY", "read", {"type": "object", "properties": {"npi": {"type": "string"}}, "required": ["npi"], "additionalProperties": False}, _get),
    Tool("compare_in_vs_out_of_network_cost", "Estimates the member's cost for a service at an in-network provider versus an out-of-network provider, given the expected allowed amount. Illustrates balance billing risk.", "MEDICAL_CORE", "read", {"type": "object", "properties": {"allowed_amount": {"type": "number"}, "service_type": {"type": "string", "enum": ["pcp", "specialist", "urgentCare", "emergency", "other"]}}, "required": ["allowed_amount", "service_type"], "additionalProperties": False}, _compare),
    Tool("report_directory_error", "WRITES: reports an inaccuracy in the provider directory (wrong phone, not accepting patients, moved). Confirm the provider and the correction with the member before calling.", "PROVIDER_DIRECTORY", "write", {"type": "object", "properties": {"npi": {"type": "string"}, "issue": {"type": "string"}}, "required": ["npi", "issue"], "additionalProperties": False}, _report),
]

provider_network = AgentDef(
    id="provider-network", title="Provider network assistant", persona=MEMBER_PERSONA, tools=tools,
    system=base_rules(
        role="the provider network assistant",
        who="Dana Whitfield, member ID W20419873, on the Prairie PPO 1500 plan (Prairie Choice PPO network), living in Cedar Rapids, Iowa.",
        scope="You help her find in-network providers, confirm whether a specific provider is in network, understand what out-of-network care costs, and report directory errors.",
        extra="Default to in-network results. When you list providers give name, specialty, distance, whether they accept new patients and next available date, at most five at a time. If a provider is leaving the network, say when and mention continuity-of-care. Never recommend one clinician over another on medical grounds; you can order by distance, availability or the directory's quality rating and say which you used.",
    ),
)
