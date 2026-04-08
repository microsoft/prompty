# Changelog

All notable changes to the Prompty C# runtime will be documented here.

## [2.0.0-alpha.1] — Unreleased

### Added
- §8.8 Structured Result Casting: `StructuredResult` class (Dictionary subclass) with `Cast<T>()` method and `PromptyCast.Cast<T>()` static helper
- Generic `InvokeAsync<T>()` and `InvokeAgentAsync<T>()` pipeline overloads
- §13 Agent Loop Extensions: events, cancellation, context window management, guardrails, steering, parallel tool execution
- `[Tool]` attribute and `ToolBinder.BindTools()` validation bridge
- Token and thinking streaming events
- Prompty.OpenAI package for OpenAI provider
- Prompty.Foundry package for Azure AI Foundry provider
- Prompty.Anthropic package for Anthropic/Claude provider
- Jinja2 (via Jinja2.NET) and Mustache (via Stubble) template renderers

### Changed
- Complete rewrite from v1 — new architecture with InvokerRegistry and pluggable providers
- `outputs` schema now returns `StructuredResult` instead of `JsonElement` (backward compatible — it's a Dictionary subclass with native .NET types)

### Fixed
- Tool guardrail denial now returns synthetic result instead of throwing
- C# context summarizer extracts tool-call names from dropped messages
