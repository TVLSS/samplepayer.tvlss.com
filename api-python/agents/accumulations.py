from agent_types import AgentDef, Tool
from data import ACCUMULATORS, ACCUMULATOR_HISTORY, FAMILY_IDS, MEMBERS, PLANS, member_accumulators, estimate_cost_share
from agents.common import base_rules, who, MEMBER_PERSONA

_plan = PLANS["PPO1500"]


def _member(i, _s):
    mid = who(i.get("member_id"))
    a = member_accumulators(mid)
    return {"memberId": mid, "name": MEMBERS[mid]["name"], "planYear": 2026, "deductible": {**a["deductible"], "remaining": a["deductible"]["limit"] - a["deductible"]["met"]}, "outOfPocket": {**a["oop"], "remaining": a["oop"]["limit"] - a["oop"]["met"]}, "dental": {**a["dental"], "remaining": a["dental"]["annualMax"] - a["dental"]["used"]}, "physicalTherapy": a["ptVisits"]}


def _family(_i, _s):
    fam = ACCUMULATORS["family"]
    return {"planYear": 2026, "family": {"deductible": {**fam["deductible"], "remaining": fam["deductible"]["limit"] - fam["deductible"]["met"]}, "outOfPocket": {**fam["oop"], "remaining": fam["oop"]["limit"] - fam["oop"]["met"]}}, "members": [{"memberId": mid, "name": MEMBERS[mid]["name"], "deductibleMet": ACCUMULATORS[mid]["deductible"]["met"], "oopMet": ACCUMULATORS[mid]["oop"]["met"]} for mid in FAMILY_IDS], "rule": "Embedded: each person stops paying deductible at $1,500 on their own, and the whole family stops once combined deductible reaches $3,000. Same pattern for out-of-pocket at $5,000 / $10,000."}


def _history(i, _s):
    return [{**h, "patient": MEMBERS[h["memberId"]]["name"]} for h in ACCUMULATOR_HISTORY if not i.get("member_id") or h["memberId"] == who(i.get("member_id"))]


def _estimate(i, _s):
    return estimate_cost_share(who(i.get("member_id")), float(i.get("allowed_amount", 0)), str(i.get("service_type", "other")))


def _limits(_i, _s):
    return {"plan": _plan["name"], "deductible": _plan["deductible"], "outOfPocketMax": _plan["outOfPocketMax"], "coinsurance": _plan["coinsurance"], "copays": _plan["copays"], "outOfNetwork": _plan["outOfNetwork"], "note": "Copays count toward the out-of-pocket maximum but not toward the deductible. Premiums and out-of-network balance bills count toward neither."}


tools = [
    Tool("get_member_accumulators", "Returns one member's in-network accumulators for the plan year: deductible met and remaining, out-of-pocket met and remaining, dental annual maximum used, and physical therapy visits used against the prior-authorization threshold.", "ACCUMULATORS", "read", {"type": "object", "properties": {"member_id": {"type": "string", "description": "Defaults to the signed-in member"}}, "additionalProperties": False}, _member),
    Tool("get_family_accumulators", "Returns the family-level deductible and out-of-pocket accumulators plus each member's contribution, and explains the embedded deductible rule.", "ACCUMULATORS", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _family),
    Tool("get_accumulator_history", "Lists every claim that moved an accumulator this plan year, in date order, with how much each applied to deductible and out-of-pocket. Optional member filter.", "ACCUMULATORS", "read", {"type": "object", "properties": {"member_id": {"type": "string"}}, "additionalProperties": False}, _history),
    Tool("estimate_member_cost", "Estimates the member's share of an in-network service from its allowed amount, applying remaining deductible, coinsurance and the out-of-pocket cap. Use service_type 'other' for anything that is not a flat-copay visit.", "ACCUMULATORS", "read", {"type": "object", "properties": {"member_id": {"type": "string"}, "allowed_amount": {"type": "number"}, "service_type": {"type": "string", "enum": ["pcp", "specialist", "urgentCare", "emergency", "other"]}}, "required": ["allowed_amount", "service_type"], "additionalProperties": False}, _estimate),
    Tool("get_plan_limits", "Returns the plan's deductible, out-of-pocket maximum, coinsurance and copays so accumulator numbers can be explained against them.", "MEDICAL_CORE", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _limits),
]

accumulations_agent = AgentDef(
    id="accumulations", title="Accumulations assistant", persona=MEMBER_PERSONA, tools=tools,
    system=base_rules(
        role="the accumulations assistant",
        who="Dana Whitfield, member ID W20419873, on the Prairie PPO 1500 plan, with spouse Marcus (W20419874) and daughter Ava (W20419875) on the same contract.",
        scope="You explain where she stands against her deductible and out-of-pocket maximum, individually and as a family, what moved the numbers, and what an upcoming service is likely to cost her.",
        extra="Always give met, limit and remaining together, for example '$1,120 met of $1,500, so $380 to go'. When estimating, show the arithmetic in one or two short lines. Mention the embedded family rule only when it changes the answer.",
    ),
)
