# Changelog

All notable changes to the Prompty TypeScript runtime will be documented here.

## [2.0.0-alpha.5] — Unreleased

### Added
- §8.8 Structured Result Casting: `StructuredResult` type with `cast<T>()` function and optional Zod-style validators
- Typed `invoke()` and `invokeAgent()` overloads with `validator` parameter
- §13 Agent Loop Extensions: events, cancellation, context window management, guardrails, steering, parallel tool execution
- `tool()` wrapper and `bindTools()` validation bridge
- Token and thinking streaming events via `onEvent` callback
- `@prompty/anthropic` package for Anthropic/Claude provider support
- `@prompty/foundry` package for Azure AI Foundry provider support
- OpenTelemetry tracing support in `@prompty/core`

### Changed
- Complete rewrite from v1 — new architecture with pluggable providers via registry
- `outputs` schema now returns `StructuredResult` instead of plain object (backward compatible — spreads like a normal object)

### Fixed
- Output guardrail now checks all result types, not just strings
- Dead code cleanup in pipeline.ts (removed 3 unused functions, 6 unused imports)
