# Changelog

All notable changes to the Prompty Python runtime will be documented here.

## [2.0.0-alpha.5] — Unreleased

### Added
- §8.8 Structured Result Casting: `StructuredResult` dict subclass and `cast()` function for zero-copy typed deserialization (dataclass, Pydantic, TypedDict)
- `target_type` parameter on `invoke()`, `invoke_async()`, `invoke_agent()`, `invoke_agent_async()`
- §13 Agent Loop Extensions: events, cancellation, context window management, guardrails, steering, parallel tool execution
- `@tool` decorator and `bind_tools()` validation bridge
- Token and thinking streaming events via `on_event` callback
- `PromptyStream` / `AsyncPromptyStream` wrappers with tracing support
- OpenAI, Azure/Foundry, and Anthropic provider support
- Jinja2 and Mustache template renderers
- OpenTelemetry tracing backend

### Changed
- Complete rewrite from v1 — new architecture based on protocol classes and entry-point discovery
- `outputs` schema now returns `StructuredResult` instead of plain `dict` (backward compatible — it's a dict subclass)

### Fixed
- OpenAI API alignment: `max_tokens` → `max_completion_tokens`, `strict` on function definition level
- Output guardrail now checks all LLM responses, not just final
- First-turn ordering: cancel → steer → trim → guard → LLM
