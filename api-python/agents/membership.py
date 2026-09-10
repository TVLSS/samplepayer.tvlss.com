from agent_types import AgentDef, Tool
from data import FAMILY_IDS, PLANS, PROVIDERS
from agents.common import base_rules, who, MEMBER_PERSONA

_PCP_SPECIALTIES = ["Family Medicine", "Pediatrics", "Internal Medicine"]


def _get(i, s):
    m = s.members[who(i.get("member_id"))]
    return {**m, "plan": PLANS[m["planId"]]["name"]}


def _dependents(_i, s):
    return [{"memberId": mid, "name": s.members[mid]["name"], "relationship": s.members[mid]["relationship"], "dob": s.members[mid]["dob"], "status": s.members[mid]["status"], "coverageStart": s.members[mid]["coverageStart"], "coverageEnd": s.members[mid]["coverageEnd"]} for mid in FAMILY_IDS]


def _eligibility(i, s):
    m = s.members[who(i.get("member_id"))]
    d = str(i.get("date") or "2026-09-10")
    eligible = d >= m["coverageStart"] and (not m["coverageEnd"] or d <= m["coverageEnd"])
    plan = PLANS[m["planId"]]
    return {"memberId": m["memberId"], "name": m["name"], "date": d, "eligible": eligible, "plan": plan["name"], "network": plan["network"], "summary": "Eligible" if eligible else "Not eligible on that date"}


def _update_contact(i, s):
    for mid in FAMILY_IDS:
        m = s.members[mid]
        if any(i.get(k) for k in ("line1", "city", "state", "zip")):
            m["address"] = {k: str(i.get(k) or m["address"][k]) for k in ("line1", "city", "state", "zip")}
        if i.get("phone"):
            m["phone"] = str(i["phone"])
        if i.get("email") and mid == "W20419873":
            m["email"] = str(i["email"])
    r = {"requestId": f"REQ-{len(s.requests) + 100001}", "applied": i, "effective": "2026-09-10", "summary": "Contact info updated for 3 members", "note": "Demo only: nothing was actually changed."}
    s.requests.append(r)
    return r


def _id_card(i, s):
    m = s.members[who(i.get("member_id"))]
    if i.get("format") == "digital":
        r = {"requestId": f"CARD-{m['memberId']}-D", "member": m["name"], "format": "digital", "link": f"https://wellmark.tvlss.com/id-card/{m['memberId']}", "summary": "Digital ID card ready", "note": "Demo only."}
    else:
        r = {"requestId": f"CARD-{m['memberId']}-M", "member": m["name"], "format": "mail", "mailingTo": m["address"], "arrives": "7 to 10 business days", "summary": "Replacement card ordered", "note": "Demo only: nothing was actually ordered."}
    s.requests.append(r)
    return r


def _change_pcp(i, s):
    p = next((p for p in PROVIDERS if p["npi"] == str(i.get("npi"))), None)
    if not p:
        return {"error": f"No provider with NPI {i.get('npi')}"}
    if p["specialty"] not in _PCP_SPECIALTIES:
        return {"error": f"{p['name']} is {p['specialty']}; a PCP must be family medicine, internal medicine or pediatrics"}
    m = s.members[who(i.get("member_id"))]
    m["pcp"] = {"npi": p["npi"], "name": p["name"], "practice": p["practice"]}
    r = {"requestId": f"PCP-{m['memberId']}", "member": m["name"], "newPcp": m["pcp"], "effective": "2026-10-01", "summary": f"PCP changed to {p['name']}", "note": "Demo only."}
    s.requests.append(r)
    return r


def _pcp_options(i, _s):
    spec = i.get("specialty")
    return [{"npi": p["npi"], "name": p["name"], "specialty": p["specialty"], "practice": p["practice"], "address": p["address"], "acceptingNewPatients": p["acceptingNewPatients"], "distanceMiles": p["distanceMiles"], "nextAvailable": p["nextAvailable"]} for p in PROVIDERS if p["specialty"] in _PCP_SPECIALTIES and "Prairie Choice PPO" in p["networks"] and (not spec or spec == "Any" or p["specialty"] == spec)]


tools = [
    Tool("get_member", "Returns the member's profile: name, date of birth, relationship, coverage status and dates, plan, group, contact details, primary care provider and when their ID card was last issued.", "MEMBERSHIP", "read", {"type": "object", "properties": {"member_id": {"type": "string", "description": "Defaults to the signed-in member"}}, "additionalProperties": False}, _get),
    Tool("list_dependents", "Lists everyone covered under the subscriber's contract with relationship, date of birth and coverage status.", "MEMBERSHIP", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _dependents),
    Tool("check_eligibility", "Confirms whether a member is eligible for coverage on a given date, and on which plan.", "MEMBERSHIP", "read", {"type": "object", "properties": {"member_id": {"type": "string"}, "date": {"type": "string", "description": "YYYY-MM-DD, defaults to today"}}, "additionalProperties": False}, _eligibility),
    Tool("update_contact_info", "WRITES: updates the subscriber's mailing address, phone or email. Applies to every family member on the contract. Confirm the new values with the member before calling.", "MEMBERSHIP", "write", {"type": "object", "properties": {"line1": {"type": "string"}, "city": {"type": "string"}, "state": {"type": "string"}, "zip": {"type": "string"}, "phone": {"type": "string"}, "email": {"type": "string"}}, "additionalProperties": False}, _update_contact),
    Tool("request_id_card", "WRITES: orders a replacement ID card (mailed) or generates a digital card link. Confirm which member and which format before calling.", "MEMBERSHIP", "write", {"type": "object", "properties": {"member_id": {"type": "string"}, "format": {"type": "string", "enum": ["mail", "digital"]}}, "required": ["format"], "additionalProperties": False}, _id_card),
    Tool("change_pcp", "WRITES: changes a member's primary care provider to an in-network provider by NPI. Confirm the provider with the member before calling. Effective the first of next month.", "MEMBERSHIP", "write", {"type": "object", "properties": {"member_id": {"type": "string"}, "npi": {"type": "string"}}, "required": ["npi"], "additionalProperties": False}, _change_pcp),
    Tool("search_pcp_options", "Lists in-network primary care providers (family medicine, internal medicine, pediatrics) near the member, with whether they accept new patients.", "PROVIDER_DIRECTORY", "read", {"type": "object", "properties": {"specialty": {"type": "string", "enum": ["Family Medicine", "Pediatrics", "Internal Medicine", "Any"]}}, "additionalProperties": False}, _pcp_options),
]

membership = AgentDef(
    id="membership", title="Membership assistant", persona=MEMBER_PERSONA, tools=tools,
    system=base_rules(
        role="the membership assistant",
        who="Dana Whitfield, member ID W20419873, the subscriber. Her contract covers her spouse Marcus (W20419874) and daughter Ava (W20419875).",
        scope="You handle membership questions and service requests: who is covered, eligibility, contact details, ID cards and primary care provider changes.",
        extra="Read the current record before proposing a change so you can show the before and after. Address changes apply to the whole family; say so.",
    ),
)
