from agent_types import AgentDef, Tool
from data import CLAIMS, FAMILY_IDS, PRIOR_AUTHS
from agents.common import base_rules, MEMBER_PERSONA

def _find(i, _s):
    out = []
    for c in CLAIMS:
        if c["memberId"] not in FAMILY_IDS:
            continue
        if i.get("status") and i["status"] != "Any" and c["status"] != i["status"]:
            continue
        if i.get("patient") and str(i["patient"]).lower() not in c["patient"].lower():
            continue
        if i.get("from_date") and c["serviceDate"] < str(i["from_date"]):
            continue
        if i.get("to_date") and c["serviceDate"] > str(i["to_date"]):
            continue
        out.append({"claimId": c["claimId"], "patient": c["patient"], "serviceDate": c["serviceDate"], "provider": c["provider"], "type": c["type"], "status": c["status"], "billed": sum(l["billed"] for l in c["lines"]), "memberResponsibility": sum(l["memberResponsibility"] or 0 for l in c["lines"]), "pendingReason": c.get("pendingReason")})
    return out


def _claim(cid):
    return next((c for c in CLAIMS if c["claimId"].upper() == str(cid).upper().strip()), None)


def _get(i, _s):
    c = _claim(i.get("claim_id"))
    return c if c and c["memberId"] in FAMILY_IDS else {"error": f"No claim {i.get('claim_id')} on this family's account"}


def _explain(i, _s):
    c = _claim(i.get("claim_id"))
    if not c or c["memberId"] not in FAMILY_IDS:
        return {"error": f"No claim {i.get('claim_id')}"}
    if c["status"] != "Denied":
        return {"claimId": c["claimId"], "status": c["status"], "note": "This claim was not denied."}
    return {"claimId": c["claimId"], "denialCode": c["denialCode"], "denialReason": c["denialReason"], "howToResolve": c["notes"], "appealDeadline": c["appealDeadline"], "options": ["Ask the provider to submit a retroactive prior authorization with clinical notes", "File a member appeal with a statement of medical necessity", "Ask the provider about their financial hardship policy"]}


def _pa(i, _s):
    c = _claim(i.get("claim_id"))
    if not c:
        return {"error": "Unknown claim"}
    pa = next((p for p in PRIOR_AUTHS if p["authId"] == c["priorAuth"]), None)
    return pa or {"claimId": c["claimId"], "priorAuth": None, "summary": "No prior authorization on file for this service"}


def _eob(i, _s):
    c = _claim(i.get("claim_id"))
    if not c or c["memberId"] not in FAMILY_IDS:
        return {"error": "Unknown claim"}
    if not c["eobAvailable"]:
        return {"claimId": c["claimId"], "eobAvailable": False, "summary": "EOB is produced when the claim finishes processing"}
    return {"claimId": c["claimId"], "eobAvailable": True, "downloadUrl": f"https://samplepayer.tvlss.com/eob/{c['claimId']}.pdf", "issued": c["processedDate"], "totals": {"billed": sum(l["billed"] for l in c["lines"]), "allowed": sum(l["allowed"] or 0 for l in c["lines"]), "planPaid": sum(l["planPaid"] or 0 for l in c["lines"]), "youOwe": sum(l["memberResponsibility"] or 0 for l in c["lines"])}}


def _appeal(i, s):
    c = _claim(i.get("claim_id"))
    if not c or c["status"] != "Denied":
        return {"error": "Only denied claims can be appealed"}
    appeal_id = f"APL-26-{7000 + len(s.appeals) + 1}"
    s.appeals.append({"appealId": appeal_id, "claimId": c["claimId"], "reason": str(i.get("reason")), "filed": "2026-09-10", "status": "Received"})
    return {"appealId": appeal_id, "claimId": c["claimId"], "status": "Received", "filed": "2026-09-10", "expectedDecisionBy": "2026-10-10", "summary": f"Appeal {appeal_id} filed", "note": "Demo only: nothing was actually filed."}


tools = [
    Tool("find_claims", "Finds claims for the member and covered dependents. Filter by status (Processed, Pending, Denied), patient name, or service date range. Returns a summary per claim.", "MEDICAL_CORE", "read", {"type": "object", "properties": {"status": {"type": "string", "enum": ["Processed", "Pending", "Denied", "Any"]}, "patient": {"type": "string", "description": "Patient first or last name"}, "from_date": {"type": "string", "description": "YYYY-MM-DD"}, "to_date": {"type": "string", "description": "YYYY-MM-DD"}}, "additionalProperties": False}, _find),
    Tool("get_claim", "Returns full detail for one claim: every line with billed, allowed, deductible, coinsurance, copay, plan paid and member responsibility, plus status, dates, denial reason and notes.", "MEDICAL_CORE", "read", {"type": "object", "properties": {"claim_id": {"type": "string", "description": "e.g. CLM-26-004481"}}, "required": ["claim_id"], "additionalProperties": False}, _get),
    Tool("explain_denial", "For a denied claim, returns the denial reason code, plain-language explanation, what would make it payable, and the appeal deadline.", "MEDICAL_CORE", "read", {"type": "object", "properties": {"claim_id": {"type": "string"}}, "required": ["claim_id"], "additionalProperties": False}, _explain),
    Tool("get_prior_auth_for_claim", "Checks whether a prior authorization exists for a claim's service and returns its decision and validity window.", "UTILIZATION_MGMT", "read", {"type": "object", "properties": {"claim_id": {"type": "string"}}, "required": ["claim_id"], "additionalProperties": False}, _pa),
    Tool("get_eob", "Returns the Explanation of Benefits summary for a processed claim and a link the member can download it from.", "MEDICAL_CORE", "read", {"type": "object", "properties": {"claim_id": {"type": "string"}}, "required": ["claim_id"], "additionalProperties": False}, _eob),
    Tool("file_appeal", "WRITES: files a first-level member appeal on a denied claim with the member's stated reason. Confirm with the member before calling. Returns an appeal ID and expected decision date.", "MEDICAL_CORE", "write", {"type": "object", "properties": {"claim_id": {"type": "string"}, "reason": {"type": "string", "description": "The member's reason for appeal, in their words"}}, "required": ["claim_id", "reason"], "additionalProperties": False}, _appeal),
]

claims_agent = AgentDef(
    id="claims", title="Claims assistant", persona=MEMBER_PERSONA, tools=tools,
    system=base_rules(
        role="the claims assistant",
        who="Dana Whitfield, member ID W20419873, subscriber on the Prairie PPO 1500 plan. Her covered dependents are her spouse Marcus (W20419874) and daughter Ava (W20419875). Dana Whitfield can see the whole family's claims.",
        scope="You help her understand claim status, what she owes and why, why a claim was denied, and how to appeal. You can file an appeal for her once she confirms.",
        extra="When explaining what a member owes, walk through allowed amount, then deductible, then coinsurance or copay, in that order, using the claim's own numbers. Explain 'allowed amount' the first time it comes up.",
    ),
)
