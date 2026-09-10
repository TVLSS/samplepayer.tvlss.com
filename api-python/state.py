"""Per-turn mutable state. Mirrors api/src/state.ts.

Everything a "write" tool changes lives here, and a fresh copy is made for every
request, so one visitor's typed-in address or appeal reason can never surface in
another visitor's conversation. The Lambda holds nothing between requests; the
browser keeps the transcript. A change made in one turn is therefore not visible
in the next: tools return the change in their result, the model repeats it in
the answer, and that answer is in the history the browser sends back."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from data import MEMBERS, GROUP, deep_copy


@dataclass
class TurnState:
    members: dict[str, dict[str, Any]] = field(default_factory=lambda: deep_copy(MEMBERS))
    group: dict[str, Any] = field(default_factory=lambda: deep_copy(GROUP))
    appeals: list[dict[str, Any]] = field(default_factory=list)
    requests: list[dict[str, Any]] = field(default_factory=list)
    changes: list[dict[str, Any]] = field(default_factory=list)
    program_enrollments: list[dict[str, Any]] = field(default_factory=list)


def new_turn_state() -> TurnState:
    return TurnState()
