"""Guardrails — optional validation hooks for the agent loop.

Guardrails let consuming apps inject validation logic at three points:

- **Input guardrail** — before each LLM call (full message list)
- **Output guardrail** — after each LLM response (assistant message)
- **Tool guardrail** — before each tool execution (tool name + args)

All guardrails are optional. When not set, execution proceeds normally.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .types import Message

__all__ = [
    "GuardrailError",
    "GuardrailResult",
    "Guardrails",
]


class GuardrailError(Exception):
    """Raised when an input or output guardrail denies the operation."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(f"Guardrail denied: {reason}")


@dataclass
class GuardrailResult:
    """Result of a guardrail check.

    Attributes
    ----------
    allowed:
        Whether the operation is allowed.
    reason:
        Required when ``allowed`` is ``False`` — explains the denial.
    """

    allowed: bool
    reason: str | None = None


# Callback signatures for the three guardrail hooks
InputGuardrail = Callable[[list[Message]], GuardrailResult]
OutputGuardrail = Callable[[Message], GuardrailResult]
ToolGuardrail = Callable[[str, dict[str, Any]], GuardrailResult]


class Guardrails:
    """Optional validation hooks for the agent loop.

    Example
    -------
    >>> guardrails = Guardrails(
    ...     input=lambda msgs: GuardrailResult(allowed=len(msgs) < 100, reason="Too many messages"),
    ...     tool=lambda name, args: GuardrailResult(allowed=name != "dangerous", reason="Blocked"),
    ... )
    """

    def __init__(
        self,
        *,
        input: InputGuardrail | None = None,
        output: OutputGuardrail | None = None,
        tool: ToolGuardrail | None = None,
    ) -> None:
        self.input = input
        self.output = output
        self.tool = tool

    def check_input(self, messages: list[Message]) -> GuardrailResult:
        """Check input guardrail.  Returns allowed if no guardrail set."""
        if self.input is None:
            return GuardrailResult(allowed=True)
        return self.input(messages)

    def check_output(self, message: Message) -> GuardrailResult:
        """Check output guardrail.  Returns allowed if no guardrail set."""
        if self.output is None:
            return GuardrailResult(allowed=True)
        return self.output(message)

    def check_tool(self, name: str, arguments: dict[str, Any]) -> GuardrailResult:
        """Check tool guardrail.  Returns allowed if no guardrail set."""
        if self.tool is None:
            return GuardrailResult(allowed=True)
        return self.tool(name, arguments)
