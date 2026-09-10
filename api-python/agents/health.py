import re

from agent_types import AgentDef, Tool
from data import PRIOR_AUTHS, CARE_PROGRAMS, NURSE_LINE, PLANS, FAMILY_IDS, MEMBERS, ACCUMULATORS, CLAIMS
from agents.common import base_rules, who, MEMBER_PERSONA

_RULES = [
    (re.compile(r"mri|ct scan|\bct\b|pet scan|imaging", re.I), "Advanced imaging", True, "Ordering provider submits; usual decision in 2 business days"),
    (re.compile(r"physical therapy|\bpt\b|therapy visits", re.I), "Physical therapy", True, "Required after 12 visits per plan year; first 12 need no authorization"),
    (re.compile(r"inpatient|hospital stay|admission|surgery", re.I), "Inpatient admission", True, "Facility submits at least 5 days before elective admission; emergencies are notified within 48 hours"),
    (re.compile(r"sleep study", re.I), "Sleep study", True, "Ordering provider submits with symptoms and screening results"),
    (re.compile(r"x-ray|xray|lab|blood test|office visit|checkup|physical|urgent care|flu shot|vaccine|immunization|mammogram|colonoscopy", re.I), "Routine and preventive care", False, "No prior authorization"),
    (re.compile(r"ozempic|humira|trulicity|specialty", re.I), "Specialty or step-therapy drug", True, "Prescriber submits to the pharmacy benefit manager"),
]


def _list_pa(i, _s):
    return [{**p, "patient": MEMBERS[p["memberId"]]["name"]} for p in PRIOR_AUTHS if p["memberId"] in FAMILY_IDS and (not i.get("member_id") or p["memberId"] == who(i.get("member_id")))]


def _check(i, _s):
    s = str(i.get("service_description", ""))
    rule = next((r for r in _RULES if r[0].search(s)), None)
    plan_list = PLANS["PPO1500"]["priorAuthRequired"]
    if not rule:
        return {"service": s, "priorAuthRequired": "Unknown", "note": "Not on the standard list; the provider can call to verify", "planList": plan_list}
    _, service, required, note = rule
    out = {"service": service, "priorAuthRequired": required, "note": note, "planList": plan_list}
    if service == "Physical therapy":
        pt = ACCUMULATORS["W20419873"]["ptVisits"]
        out.update({"visitsUsedThisYear": pt["used"], "threshold": pt["priorAuthAfter"]})
    return out


def _programs(_i, s):
    has_msk = any(c["memberId"] == "W20419873" and re.search(r"Orthopedics|Physical Therapy", c["provider"]) for c in CLAIMS)
    return [{**p, "enrolled": any(e["programId"] == p["programId"] and e["memberId"] == "W20419873" for e in s.program_enrollments), "likelyEligible": has_msk if p["programId"] == "MSK" else p["programId"] in ("TOB", "BH")} for p in CARE_PROGRAMS]


def _enroll(i, s):
    p = next((p for p in CARE_PROGRAMS if p["programId"] == i.get("program_id")), None)
    if not p:
        return {"error": "Unknown program"}
    s.program_enrollments.append({"memberId": "W20419873", "programId": p["programId"], "enrolledDate": "2026-09-10", "status": "Enrolled"})
    return {"program": p["name"], "status": "Enrolled", "enrolledDate": "2026-09-10", "nextStep": "A program coordinator calls within 2 business days to schedule the first session", "summary": f"Enrolled in {p['name']}", "note": "Demo only: nothing was actually enrolled."}


def _nurse(_i, _s):
    c = PLANS["PPO1500"]["copays"]
    return {"nurseLine": NURSE_LINE, "telehealth": {"copay": c["telehealth"], "note": "Virtual urgent care visits through the plan's telehealth partner, 24/7"}, "urgentCareCopay": c["urgentCare"], "emergencyCopay": c["emergency"]}


def _expedite(i, _s):
    pa = next((p for p in PRIOR_AUTHS if p["authId"].upper() == str(i.get("auth_id")).upper().strip()), None)
    if not pa:
        return {"error": f"No authorization {i.get('auth_id')}"}
    if pa["decision"] != "Pending clinical review":
        return {"authId": pa["authId"], "decision": pa["decision"], "summary": "Already decided; nothing to expedite"}
    return {"authId": pa["authId"], "ticket": "UM-31907", "status": "Escalated to clinical reviewer", "expectedBy": "2026-09-11", "summary": "Status update requested", "note": "Demo only."}


tools = [
    Tool("list_prior_auths", "Lists prior authorization requests for the member and dependents with status, decision dates and validity windows.", "UTILIZATION_MGMT", "read", {"type": "object", "properties": {"member_id": {"type": "string"}}, "additionalProperties": False}, _list_pa),
    Tool("check_prior_auth_required", "Checks whether a described service needs prior authorization under the plan and who submits it.", "UTILIZATION_MGMT", "read", {"type": "object", "properties": {"service_description": {"type": "string", "description": "e.g. 'MRI of the knee', 'sleep study', 'physical therapy'"}}, "required": ["service_description"], "additionalProperties": False}, _check),
    Tool("list_care_programs", "Lists care management programs the plan offers, with eligibility, cost share and whether the member is enrolled. Flags programs the member appears eligible for based on recent claims.", "CARE_MGMT", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _programs),
    Tool("enroll_in_program", "WRITES: enrolls the member in a care management program. Confirm the program with the member before calling.", "CARE_MGMT", "write", {"type": "object", "properties": {"program_id": {"type": "string", "enum": ["MSK", "DIAB", "MAT", "TOB", "BH"]}}, "required": ["program_id"], "additionalProperties": False}, _enroll),
    Tool("get_nurse_line", "Returns the 24/7 nurse line and telehealth options with cost share.", "CARE_MGMT", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _nurse),
    Tool("request_prior_auth_status_update", "WRITES: asks the utilization management team to expedite or give a status update on a pending prior authorization. Confirm with the member before calling.", "UTILIZATION_MGMT", "write", {"type": "object", "properties": {"auth_id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["auth_id"], "additionalProperties": False}, _expedite),
]

health_services = AgentDef(
    id="health-services", title="Health services assistant", persona=MEMBER_PERSONA, tools=tools,
    system=base_rules(
        role="the health services assistant",
        who="Dana Whitfield, member ID W20419873, on the Prairie PPO 1500 plan, with spouse Marcus (W20419874) and daughter Ava (W20419875) covered.",
        scope="You help with prior authorizations, care management programs, the nurse line and telehealth. You explain what needs approval and how to get it; you do not judge whether care is needed.",
        extra="If the member describes symptoms, do not assess them. Acknowledge briefly, give the nurse line, and answer the coverage question. If Dana asks about knee pain, physical therapy or the MSK program together, it is fine to point out she looks eligible for the back and joint care program, which has no cost share.",
    ),
)
