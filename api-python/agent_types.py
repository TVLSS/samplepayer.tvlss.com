"""Shared shapes for demo agents. Mirrors api/src/types.ts."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from state import TurnState

ToolResult = dict[str, Any] | list[Any]


@dataclass
class Tool:
    name: str
    description: str
    system: str            # which back-office system this tool reads; shown in the ledger
    kind: str              # "read" | "write"; write tools must be confirmed with the user first
    input_schema: dict[str, Any]
    # run(input, state): state is this request's private copy of everything writable; see state.py
    run: Callable[[dict[str, Any], "TurnState"], ToolResult]


@dataclass
class AgentDef:
    id: str
    title: str
    persona: str
    system: str
    tools: list[Tool] = field(default_factory=list)
