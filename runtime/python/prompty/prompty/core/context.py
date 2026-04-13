"""Context window management — trimming and summarization.

When agent loop conversations grow too long, this module trims older
non-system messages and produces a compact summary to preserve context.
"""

from __future__ import annotations

from .types import Message, TextPart

__all__ = [
    "estimate_chars",
    "format_dropped_messages",
    "summarize_dropped",
    "trim_to_context_window",
]


def format_dropped_messages(messages: list[Message]) -> str:
    """Format dropped messages as readable text for compaction prompts.

    Each message is rendered as ``[role]: text`` with tool calls shown
    as ``Called: name(args)``.
    """
    import json

    lines: list[str] = []
    for msg in messages:
        text = msg.text.strip() if msg.text else ""
        if text:
            lines.append(f"[{msg.role}]: {text}")
        tool_calls = msg.metadata.get("tool_calls")
        if tool_calls and isinstance(tool_calls, list):
            for tc in tool_calls:
                name = tc.get("name", tc.get("function", {}).get("name", "?"))
                args = tc.get("arguments", tc.get("function", {}).get("arguments", ""))
                if isinstance(args, dict):
                    args = json.dumps(args)
                lines.append(f"Called: {name}({args})")
    return "\n".join(lines)


def estimate_chars(messages: list[Message]) -> int:
    """Estimate the character cost of a message list.

    Per spec §13.3: role + 4 overhead per message, text parts by length,
    non-text parts at a fixed 200-char estimate, tool_calls by JSON length.
    """
    import json

    total = 0
    for msg in messages:
        total += len(msg.role) + 4
        for part in msg.parts:
            if isinstance(part, TextPart):
                total += len(part.value)
            else:
                total += 200
        tool_calls = msg.metadata.get("tool_calls")
        if tool_calls:
            total += len(json.dumps(tool_calls, default=str))
    return total


def _truncate(text: str, max_len: int = 200) -> str:
    """Truncate a string to at most *max_len* characters."""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "…"


def summarize_dropped(messages: list[Message]) -> str:
    """Build a compact string summary from dropped messages.

    Extracts user requests, assistant decisions, and tool actions
    without needing an LLM call.
    """
    lines: list[str] = []
    for msg in messages:
        text = msg.text.strip() if msg.text else ""
        if msg.role == "user":
            if text:
                lines.append(f"User asked: {_truncate(text)}")
        elif msg.role == "assistant":
            if text:
                lines.append(f"Assistant: {_truncate(text)}")
            tool_calls = msg.metadata.get("tool_calls")
            if tool_calls and isinstance(tool_calls, list):
                names = [tc.get("name", tc.get("function", {}).get("name", "?")) for tc in tool_calls]
                lines.append(f"  Called tools: {', '.join(names)}")
        # Skip tool-result messages (captured in assistant summary)

    if not lines:
        return ""

    # Cap the summary at ~4000 chars
    result = "[Context summary: "
    for line in lines:
        if len(result) + len(line) > 4000:
            result += "\n... (older messages omitted)"
            break
        result += line + "\n"
    result = result.rstrip() + "]"
    return result


def trim_to_context_window(
    messages: list[Message],
    budget_chars: int,
) -> tuple[int, list[Message]]:
    """Trim messages to fit within a character budget.

    Strategy per spec §13.3:
    1. Keep system messages at the front
    2. Reserve space for summary (~5000 chars or 5% of budget)
    3. Drop oldest non-system messages until within budget
    4. Summarize dropped messages and insert after system messages

    Returns
    -------
    tuple[int, list[Message]]
        (count of dropped messages, the dropped messages themselves)
    """
    if estimate_chars(messages) <= budget_chars:
        return 0, []

    # Partition: leading system messages vs rest
    system_end = 0
    for i, msg in enumerate(messages):
        if msg.role != "system":
            system_end = i
            break
    else:
        system_end = len(messages)

    system_msgs = messages[:system_end]
    rest = messages[system_end:]

    summary_budget = min(5000, int(budget_chars * 0.05))

    # Drop oldest non-system messages
    dropped: list[Message] = []
    while estimate_chars(system_msgs + rest) > (budget_chars - summary_budget) and len(rest) > 2:
        dropped.append(rest.pop(0))

    dropped_count = len(dropped)

    if dropped_count > 0:
        summary_text = summarize_dropped(dropped)
        if summary_text:
            summary_msg = Message(
                role="user",
                parts=[TextPart(value=summary_text)],
            )
            messages.clear()
            messages.extend(system_msgs)
            messages.append(summary_msg)
            messages.extend(rest)
        else:
            messages.clear()
            messages.extend(system_msgs)
            messages.extend(rest)
    else:
        messages.clear()
        messages.extend(system_msgs)
        messages.extend(rest)

    return dropped_count, dropped
