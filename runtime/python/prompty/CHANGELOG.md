# Changelog

All notable changes to the Prompty Python runtime will be documented here.

## [2.0.1](https://github.com/microsoft/prompty/compare/python/2.0.0...python-2.0.1) (2026-09-10)


### Bug Fixes

* **python:** exempt strict-mode nonce from numeric coercion ([#520](https://github.com/microsoft/prompty/issues/520)) ([#541](https://github.com/microsoft/prompty/issues/541)) ([089167c](https://github.com/microsoft/prompty/commit/089167cf168a896ac4b2d57c8c16afe5d34c1d9f))

## [2.0.0](https://github.com/microsoft/prompty/compare/python-2.0.0-beta.3...python-2.0.0) (2026-09-10)


### Features

* §8.8 Structured Result Casting for Python and TypeScript ([f0cd82c](https://github.com/microsoft/prompty/commit/f0cd82c694a5b96f0576c4e5916845cf44126cb9))
* add agent loop resilience (§9.8, §9.9, §9.10) ([d6df11b](https://github.com/microsoft/prompty/commit/d6df11b4b85ec037201ce9573c62e5893dbc2f7b))
* add bind_tools validation bridge across all runtimes ([0393d56](https://github.com/microsoft/prompty/commit/0393d56cdb1f4052bb0f4383187e1fc283860031))
* add context compaction across all runtimes + Rust DX improvements ([3490cbb](https://github.com/microsoft/prompty/commit/3490cbba4110fd5ea57193fa194cabd55f2b6eac))
* add context compaction across all runtimes + Rust DX improvements ([#345](https://github.com/microsoft/prompty/issues/345)) ([3490cbb](https://github.com/microsoft/prompty/commit/3490cbba4110fd5ea57193fa194cabd55f2b6eac))
* agent loop resilience, structured output fix, Entra ID tests, mock pipeline tests ([6bfdfee](https://github.com/microsoft/prompty/commit/6bfdfee81cd12b6519a408e56f726e0fe5b1ab17))
* **emitter:** add [@factory](https://github.com/factory) and [@helper](https://github.com/helper) decorators with cross-runtime generation ([0a33ad9](https://github.com/microsoft/prompty/commit/0a33ad913d0248d8ace0c36ac5d784a79dc6946b))
* **emitter:** add enum support for TypeSpec string-literal unions ([94dd8b9](https://github.com/microsoft/prompty/commit/94dd8b90fc73e61dd7740f7d4e663be277a76187))
* **emitter:** add nested factory methods + unified import model (Phase 3) ([1f4ff15](https://github.com/microsoft/prompty/commit/1f4ff1596097a00e8337ec50689e86c74a4c7f97))
* **emitter:** Declaration IR, language-agnostic lowering, Python emitter, rename to prompty-emitter (Phase 4) ([a4e557e](https://github.com/microsoft/prompty/commit/a4e557e92537a487bae42dbe4eff7bd74a8d4a27))
* **emitter:** E1b/c/d - group-aware folder emission across all 5 runtimes ([e200966](https://github.com/microsoft/prompty/commit/e200966e0f779518d882f739a282ac0058d7606d))
* **emitter:** Phase 1a — decorator renames, FieldRead IR, new decorators ([0f5b83e](https://github.com/microsoft/prompty/commit/0f5b83e69c7b681ef5999f81daa0cb8dbdfb470d))
* **emitter:** wire expression IR into all 5 language emitters (Phase 2) ([b567847](https://github.com/microsoft/prompty/commit/b5678470b58ecc5cc150fa5cd41fb934fd203b0a))
* **engine:** promote generated ResumeContext into the live resume path ([3b46e09](https://github.com/microsoft/prompty/commit/3b46e09b409c91738246a8b6204f14ecd300a7af))
* fix remaining issues — nullable protocols, C# async migration, Rust/Go helpers ([9be0745](https://github.com/microsoft/prompty/commit/9be07452d9ff8fd04ebbb8495c9a34308ac6119d))
* implement tool binding injection in Python and TypeScript ([8cb00c8](https://github.com/microsoft/prompty/commit/8cb00c80282a0a9142f23512d32abfb86cb3b0aa))
* **memory:** promote agent memory into canonical prompty ([d551391](https://github.com/microsoft/prompty/commit/d551391d03292bf23ddfc69bfaa287c3c86a8972))
* **memory:** promote tiered agent memory into canonical prompty ([a92d404](https://github.com/microsoft/prompty/commit/a92d40496a398804d91df879897a78eed53c7664))
* **model:** add reasoningEffort to ModelOptions ([fc07e78](https://github.com/microsoft/prompty/commit/fc07e784bbd4e1d4aa18ccff7383b6ad483f1e7f))
* **model:** add Typra-owned ModelLister discovery protocol for OpenAI/Anthropic/Foundry ([fe3133a](https://github.com/microsoft/prompty/commit/fe3133adfa5e5ba3037449e7348b071e9ca475fd))
* **model:** service-drill conformance vector on the callable seam ([d8cb188](https://github.com/microsoft/prompty/commit/d8cb188f92edb3d3a934f1d2a884264926d4f49d))
* promote spec.md types to TypeSpec (pipeline, usage, events, tools) ([430fb20](https://github.com/microsoft/prompty/commit/430fb20533d09d4ba9fa24a0533ab14bb22ecd6b))
* Prompty v2 rebuild + Typra 2.0.2 model regen (7 runtimes green) ([5360d90](https://github.com/microsoft/prompty/commit/5360d90af63b5ff7f4cf2bdb5c74b540351550d0))
* Prompty v2 rebuild + Typra 2.0.2 model regen (7 runtimes green) ([72f3b53](https://github.com/microsoft/prompty/commit/72f3b531a248e39448fa4f960a2dfa2d3476ad8a))
* PromptyTool support in Responses API + wire projection tests ([6f9cdec](https://github.com/microsoft/prompty/commit/6f9cdec2d6ac6a3005cbe27035731e6e635b5722))
* protocol emission via [@protocol](https://github.com/protocol) decorator + strict toWire() fix ([5b3a73e](https://github.com/microsoft/prompty/commit/5b3a73e9b52339ee5346d5f2d73d9db1a79742bc))
* **protocols:** make generated protocols canonical with optional/sync support ([a839628](https://github.com/microsoft/prompty/commit/a83962829ed4e97d384c73333189d0f7ea44270c))
* **python:** add live provider capability guard reference ([96e3c3b](https://github.com/microsoft/prompty/commit/96e3c3b043202993260fb1688e09f3f55db9dcd6))
* **python:** agent loop extensions and tool decorator ([ea88e67](https://github.com/microsoft/prompty/commit/ea88e67af6ebe2013a41de6e2269895d347ef0a8))
* **python:** graduate Python runtime to 2.0.0 ([#535](https://github.com/microsoft/prompty/issues/535)) ([fde5e64](https://github.com/microsoft/prompty/commit/fde5e64d6ffedcf364bb253c49e1b01f3de58e07))
* **python:** guard deprecated sampling params, translate reasoningEffort ([09f5ce2](https://github.com/microsoft/prompty/commit/09f5ce206b82eb02c1354ea8455ef4f23f5f74ca))
* **python:** live integration plumbing for real Entra-auth endpoints ([c50c3cc](https://github.com/microsoft/prompty/commit/c50c3cc0e0ab481fbdd26ee318ef7cb7ba83a543))
* **python:** provider-agnostic run + runTurn engines; remove all vector waivers ([c039272](https://github.com/microsoft/prompty/commit/c0392725ac12d5e2fa5d3116f3bb9566848483fe))
* **python:** support image/file/audio rich-kind nonces in pipeline ([5c188c7](https://github.com/microsoft/prompty/commit/5c188c765182c483ddd288b528ca53d0ede7e4a5))
* **python:** wire ToolResult through pipeline, remove mode from PromptyToolHandler ([2a99e24](https://github.com/microsoft/prompty/commit/2a99e2489ab663b026b8af1c8f4e99e22bb12385))
* regen model tree on @typra/emitter 2.1.6 + retire dispatch doubles ([#511](https://github.com/microsoft/prompty/issues/511)) ([e769acc](https://github.com/microsoft/prompty/commit/e769accee1e20e0a068aaff36fe072086a7ed6ab))
* regen model tree on @typra/emitter 2.1.6 + retire dispatch doubles ([#511](https://github.com/microsoft/prompty/issues/511)) ([c736092](https://github.com/microsoft/prompty/commit/c73609298a0c56d823e4c3531182e5ccbeed93a7))
* remove all Nunjucks templates, replace with typed TypeScript emitters ([58b54d0](https://github.com/microsoft/prompty/commit/58b54d0dabff16667fb4b39600cc6e17a59bc6b2))
* replace hand-written GuardrailResult with generated model type across all runtimes ([c1a905c](https://github.com/microsoft/prompty/commit/c1a905c040022a60deb31772024f77434c2e7434))
* **schema:** add live invocation contracts ([81cea0d](https://github.com/microsoft/prompty/commit/81cea0d0b4453d17040a7dd63ca4759cbcc41082))
* **schema:** add live turn-engine data contracts + run identity to TypeSpec ([10f35ee](https://github.com/microsoft/prompty/commit/10f35ee3ee05b487e05838da909369fb5ae35e93))
* **schema:** migrate all 10 conformance stages to TypeSpec [@vector](https://github.com/vector) single source of truth ([6dda877](https://github.com/microsoft/prompty/commit/6dda877a1c80e3249fbe729ba82e4708fc157ab9))
* two-layer tool registry (spec §11.2) + pipeline dispatch wiring ([3cd42df](https://github.com/microsoft/prompty/commit/3cd42df490049fa7c9fb8496cb470cd4b575b86f))
* wire format toWire() generation via knownAs decorator ([8f96e23](https://github.com/microsoft/prompty/commit/8f96e239bfcdd007001e992c3b1fc3dc49eb8e24))
* wire ToolResult through Rust runtime + remove PromptyTool mode ([6dfb1df](https://github.com/microsoft/prompty/commit/6dfb1df710980ead077e544d043ed126be939faf))


### Bug Fixes

* §13 agent loop gaps — first-turn ordering, guardrail rewrite, output guardrail, sync parallel ([cd0e2a4](https://github.com/microsoft/prompty/commit/cd0e2a4585dcbcf48765b2fa1286e783ca2a86db))
* add connection kind guards + improve Foundry empty-endpoint error ([ab96b85](https://github.com/microsoft/prompty/commit/ab96b8500e6c942b88a5ecaac3ef9c2d895ddb4a))
* align Foundry deployment discovery and inference ([d096266](https://github.com/microsoft/prompty/commit/d09626625b91f3a18b322aa1d6e157d5611d4311))
* audit cleanup — use production code in all spec vector tests ([364f423](https://github.com/microsoft/prompty/commit/364f423e67b63c36273c8342e58e5d634455ea1b))
* C# emitter string escaping, Message.role default, and Metadata null safety ([bf02093](https://github.com/microsoft/prompty/commit/bf02093cb07b6dab62a0fc1e97b14baf4d32cdd5))
* **csharp:** disable test parallelism to prevent registry race ([1f9aded](https://github.com/microsoft/prompty/commit/1f9aded6f4b860e009eb78e3db0e2cf523a6b777))
* emitter bugs — Python save_parts serialization, test string escaping, stale Rust tests ([2a205de](https://github.com/microsoft/prompty/commit/2a205de8f0618fe77d66182f1b4e3acd7115c7b3))
* **emitter:** strip trailing whitespace, fix C# string bug, format test output ([e2e7173](https://github.com/microsoft/prompty/commit/e2e7173936f6e560a4c41200c8499d215136e9a6))
* format generated Python/C# code for CI compliance ([cb9760e](https://github.com/microsoft/prompty/commit/cb9760e8e6a6b8cc8465b6e59b670a19b50eec03))
* **openai:** preserve strict Responses nullability ([59aa142](https://github.com/microsoft/prompty/commit/59aa1426cdb36dbab3c70c4d96c5bc0701ea4084))
* PromptyTool robustness — circular refs, empty inputs, path guard, test quality ([8b6caa4](https://github.com/microsoft/prompty/commit/8b6caa4a2d0ab12619d57ed35cb7e821897a46c2))
* **providers:** extend union/nullability wire guard to c#, python, typescript ([a63c805](https://github.com/microsoft/prompty/commit/a63c805e2ad90f477846cdd48986d6202417411d))
* Python emitter detects factory/field name collisions and prefixes with create_ ([bbf8550](https://github.com/microsoft/prompty/commit/bbf85508a83c729c8745bb25494d07b68346fa7a))
* Python emitter snake_case + PromptyTool mode field + test cleanup ([2367405](https://github.com/microsoft/prompty/commit/2367405c81360fd94c59ad5c68fa947a50ba22f8))
* **python:** eliminate ReDoS in chat parser role-boundary regex ([#457](https://github.com/microsoft/prompty/issues/457)) ([c9299f1](https://github.com/microsoft/prompty/commit/c9299f17e4feac667779772d2b8cedc7c670086c))
* re-emit model files from TypeSpec, fix scalar collection loader ([aeb9466](https://github.com/microsoft/prompty/commit/aeb94667bed91dd674e42019ab3368fac4506981))
* recursive array/object JSON Schema in tool params across all runtimes ([#332](https://github.com/microsoft/prompty/issues/332)) ([40aad82](https://github.com/microsoft/prompty/commit/40aad822fc120738d9ec11900f62240fbd2e5caa))
* reference index slug so /reference/ link resolves ([f318f1d](https://github.com/microsoft/prompty/commit/f318f1dd9f46c0fb65a4f45ff7e1a39528952d82))
* remove backward-compat aliases for execute (clean break at alpha) ([bfdaef5](https://github.com/microsoft/prompty/commit/bfdaef5b3081e36ddbad138a615a5880dc3384e4))
* rewrite spec vector tests to exercise production code ([6f2bde6](https://github.com/microsoft/prompty/commit/6f2bde6eff0562b37db1edc7922d310f07dcd8ae))
* **rust:** unwrap structured output in invoke() + add mock pipeline tests ([eceaeaa](https://github.com/microsoft/prompty/commit/eceaeaa5d9ddd58895a61d0cbf4078d7be0ae692))
* salvage nested strict-mode ([#441](https://github.com/microsoft/prompty/issues/441)) and Anthropic transport hardening ([#443](https://github.com/microsoft/prompty/issues/443)) onto 0.9.0 ([#481](https://github.com/microsoft/prompty/issues/481)) ([345f767](https://github.com/microsoft/prompty/commit/345f7679dc7dc940e13981ed37c1e29a6c3c710e))
* **schema:** complete union nullability release ([fdbc4ac](https://github.com/microsoft/prompty/commit/fdbc4ac4f536dd7160677fd6097550bf33516f3b))
* **schema:** repair mojibake in agent conformance vectors ([6735f33](https://github.com/microsoft/prompty/commit/6735f33b47b43e70157c4074558ababf2fbce0ba))
* **schema:** support nullable union properties ([1f8e3d1](https://github.com/microsoft/prompty/commit/1f8e3d17d247ae686240d78c9e86f1bae037f637))
* **schema:** trim trailing whitespace in agent instructions sample ([00b8052](https://github.com/microsoft/prompty/commit/00b8052a7d0da15b7a06198402ae89496453f533))
* **security:** restrict file reference resolution to allowed roots ([88ac994](https://github.com/microsoft/prompty/commit/88ac9948d7d37995edbb2f6d36913436626c39e1))
* structured output integration tests + python formatting ([1d97743](https://github.com/microsoft/prompty/commit/1d97743f76b88a059a8a6de6e840f3045dd09488))
* token streaming events and TS dead code cleanup ([aa17360](https://github.com/microsoft/prompty/commit/aa1736030449dd4617713957a3de105007735950))
* TS emitter loadParts guard for types without name property ([2fe50f2](https://github.com/microsoft/prompty/commit/2fe50f256c16ca5cd3dddf2bfdc708d6b4866140))
* TS wildcard fallback + 26 TS tool-dispatch tests + lint cleanup ([431b52d](https://github.com/microsoft/prompty/commit/431b52df6d86765e1071486378a9f54c09f3c102))
* use annotated tags in all release scripts ([32da0ff](https://github.com/microsoft/prompty/commit/32da0ff33968230740c66d55fb9ca898ce6347fd))
* use ruff format in Python emitter driver (matches CI) ([9f21dab](https://github.com/microsoft/prompty/commit/9f21dab9791a33fc9087fc65dc016e205330bee8))
* use snake_case attribute names in foundry executor ([d19aa0a](https://github.com/microsoft/prompty/commit/d19aa0af28864411b0d32e30f50ba26aee029c80))


### Performance Improvements

* fix to_dict MagicMock recursion — 10min tests → 11s ([c1fa82e](https://github.com/microsoft/prompty/commit/c1fa82e942f5c2e0233d93ae7fc4bd0d44e145d8))


### Reverts

* **model:** back service-drill vector out of the conformance rail ([b150871](https://github.com/microsoft/prompty/commit/b150871237ec8a3784e0d769e8255e01b9afbf60))

## [Unreleased]

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
