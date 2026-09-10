import calendar
from datetime import date, timedelta

from agent_types import AgentDef, Tool
from data import GROUP, deep_copy
from agents.common import base_rules, GROUP_PERSONA

_state = deep_copy(GROUP)
_changes: list[dict] = []


def _get_group(_i):
    return {k: v for k, v in _state.items() if k not in ("invoices", "renewal", "pending", "enrollmentByMonth")}


def _enrollment(_i):
    return {"eligibleEmployees": _state["eligibleEmployees"], "enrolledSubscribers": _state["enrolledSubscribers"], "participationRate": round(_state["enrolledSubscribers"] / _state["eligibleEmployees"] * 1000) / 10, "totalCoveredLives": _state["totalCoveredLives"], "byPlan": _state["plans"], "enrollmentByMonth": _state["enrollmentByMonth"], "pending": _state["pending"]}


def _renewal(_i):
    return {"renewalDate": _state["renewalDate"], **_state["renewal"]}


def _invoices(i):
    return [inv for inv in _state["invoices"] if not i.get("status") or i["status"] == "Any" or inv["status"] == i["status"]]


def _invoice_detail(i):
    inv = next((x for x in _state["invoices"] if x["invoiceId"].upper() == str(i.get("invoice_id")).upper().strip()), None)
    if not inv:
        return {"error": f"No invoice {i.get('invoice_id')}"}
    return {**inv, "lines": [{"plan": "Prairie PPO 1500", "tier": "Employee", "count": 48, "rate": 612, "amount": 29376}, {"plan": "Prairie PPO 1500", "tier": "Employee + spouse", "count": 31, "rate": 1286, "amount": 39866}, {"plan": "Prairie PPO 1500", "tier": "Family", "count": 42, "rate": 1794, "amount": 75348}, {"plan": "Prairie HDHP 3000", "tier": "Employee", "count": 29, "rate": 498, "amount": 14442}, {"plan": "Prairie HDHP 3000", "tier": "Employee + spouse", "count": 12, "rate": 1046, "amount": 12552}, {"plan": "Prairie HDHP 3000", "tier": "Family", "count": 21, "rate": 1459, "amount": 30639}], "adjustments": [{"type": "Retro termination", "member": "K. Brandvold", "effective": "2026-08-01", "amount": -1286}, {"type": "New add", "member": "T. Nguyen (family)", "effective": "2026-09-01", "amount": 1794}], "dental": 12405, "vision": 2380}


def _add_employee(i):
    try:
        hire = date.fromisoformat(str(i.get("hire_date")))
    except ValueError:
        return {"error": "hire_date must be YYYY-MM-DD"}
    plus30 = hire + timedelta(days=30)
    eff = (date(plus30.year + (plus30.month // 12), plus30.month % 12 + 1, 1)).isoformat()
    plan = next((p["name"] for p in _state["plans"] if p["planId"] == i.get("plan_id")), None)
    r = {"changeId": f"ENR-{1000 + len(_changes) + 1}", "employee": i.get("employee_name"), "plan": plan, "coverageTier": i.get("coverage_tier"), "hireDate": i.get("hire_date"), "effectiveDate": eff, "summary": f"{i.get('employee_name')} enrolled effective {eff}", "note": "Demo only: nothing was actually enrolled."}
    _changes.append(r)
    _state["enrolledSubscribers"] += 1
    return r


def _terminate(i):
    d = str(i.get("last_day"))
    y, m = int(d[:4]), int(d[5:7])
    end = date(y, m, calendar.monthrange(y, m)[1]).isoformat()
    r = {"changeId": f"TRM-{500 + len(_changes) + 1}", "employee": i.get("employee_name"), "lastDay": d, "coverageEnds": end, "cobraNoticeMailed": "Within 14 days", "summary": f"{i.get('employee_name')} coverage ends {end}", "note": "Demo only."}
    _changes.append(r)
    return r


tools = [
    Tool("get_group", "Returns the employer group's profile: contract dates, renewal date, eligibility rules, headcount, plans offered with employer contribution, ancillary lines, broker and open enrollment window.", "GROUP_ADMIN", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _get_group),
    Tool("get_enrollment_summary", "Returns enrollment by plan, covered lives, participation rate, month-by-month subscriber counts and pending items (new hires awaiting enrollment, COBRA, terminations).", "GROUP_ADMIN", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _enrollment),
    Tool("get_renewal", "Returns the renewal proposal: proposed rate change, last year's change, cost drivers, alternative plan designs with their rate impact, and the decision deadline.", "GROUP_ADMIN", "read", {"type": "object", "properties": {}, "additionalProperties": False}, _renewal),
    Tool("list_invoices", "Lists group premium invoices with amount, due date and payment status.", "BILLING", "read", {"type": "object", "properties": {"status": {"type": "string", "enum": ["Open", "Paid", "Any"]}}, "additionalProperties": False}, _invoices),
    Tool("get_invoice_detail", "Breaks one invoice down by plan and coverage tier, and lists adjustments (new adds, terminations, retro changes).", "BILLING", "read", {"type": "object", "properties": {"invoice_id": {"type": "string"}}, "required": ["invoice_id"], "additionalProperties": False}, _invoice_detail),
    Tool("add_employee", "WRITES: enrolls a new employee (and dependents) in a plan effective on their eligibility date. Confirm name, hire date, plan and coverage tier with the administrator before calling.", "GROUP_ADMIN", "write", {"type": "object", "properties": {"employee_name": {"type": "string"}, "hire_date": {"type": "string", "description": "YYYY-MM-DD"}, "plan_id": {"type": "string", "enum": ["PPO1500", "HDHP3000"]}, "coverage_tier": {"type": "string", "enum": ["Employee", "Employee + spouse", "Employee + children", "Family"]}}, "required": ["employee_name", "hire_date", "plan_id", "coverage_tier"], "additionalProperties": False}, _add_employee),
    Tool("terminate_employee", "WRITES: terminates an employee's coverage at end of the month of their last day and triggers the COBRA notice. Confirm name and last day before calling.", "GROUP_ADMIN", "write", {"type": "object", "properties": {"employee_name": {"type": "string"}, "last_day": {"type": "string", "description": "YYYY-MM-DD"}}, "required": ["employee_name", "last_day"], "additionalProperties": False}, _terminate),
    Tool("list_changes", "Lists enrollment changes made during this conversation.", "GROUP_ADMIN", "read", {"type": "object", "properties": {}, "additionalProperties": False}, lambda _i: _changes),
]

group_agent = AgentDef(
    id="group", title="Group administrator assistant", persona=GROUP_PERSONA, tools=tools,
    system=base_rules(
        role="the employer group assistant",
        who="Renee Castillo, HR Director at Cedar Rapids Machine Works (group G-44812), the group's benefits administrator. She is not a member; she administers the group.",
        scope="You help her with the group's plans, enrollment, billing, renewal and employee changes. You never disclose an individual employee's claims or health information; you can only discuss enrollment and billing facts.",
        extra="For renewal questions, give the numbers first and the drivers second, and lay out the alternatives side by side in a short list. Percentages as 6.8%.",
    ),
)
