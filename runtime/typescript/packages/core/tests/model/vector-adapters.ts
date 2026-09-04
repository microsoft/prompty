/**
 * Runtime-authored @vector conformance adapters for the TypeScript runtime.
 *
 * Typra emits `vector-conformance.test.ts`, which replays every `@vector` in the
 * TypeSpec schema through the adapters registered here. Each adapter maps a
 * `Contract.operation` key to an `invoke(resolvedInput, context)` callable (and
 * optional `normalize(observed, context)`); the harness awaits the invocation,
 * normalizes it, and asserts canonical JSON equality against the vector's
 * `expected`.
 *
 * This module is the single seam binding the abstract cross-runtime behavior
 * vectors to the concrete TypeScript implementation. It is the counterpart of
 * the Python runtime's `tests/model/vector_adapters.py` and replaces the former
 * bespoke `tests/spec-vectors.test.ts` runner: the vectors are the source of
 * truth and every runtime authors an adapter like this one.
 *
 * Design notes:
 *  - `project` implements the subset semantics the load/wire vectors rely on:
 *    observed may carry extra keys, but every key present in `expected` must
 *    match. List lengths must agree (mismatches surface, never truncated).
 *  - `vectorWaivers` records contracts the TypeScript runtime does not yet
 *    satisfy to the canonical spec. Waivers are explicit and reasoned — they
 *    surface real conformance gaps rather than hiding them.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify as yamlStringify } from "yaml";

import {
  Agent,
  AllowAllPermissionResolver,
  CollectingEventSink,
  DenyAllPermissionResolver,
  FormatConfig,
  FunctionHostToolExecutor,
  FunctionTool,
  Binding,
  Model,
  ModelOptions,
  HostToolRequest,
  InMemoryCheckpointStore,
  JsonlEventJournalWriter,
  LoadContext,
  Message,
  ParserConfig,
  Property,
  ReferenceTurnRunner,
  RunTurnRequest,
  Template,
  TurnModelResponse,
  load,
  registerParser,
  registerRenderer,
  renderSegments,
  validateInputs,
  MustacheRenderer,
  NunjucksRenderer,
  PromptyChatParser,
  runAgentLoop,
  totalMessages,
  runTurnEngine,
  SUMMARY_PREFIX,
  type AgentToolCall,
  type ModelResponse,
  type AgentGuardrailDecision,
  type AgentSteeringMessage,
  type TurnModelTurn,
  type TurnToolCall,
  type TurnToolResult,
} from "../../src/index.js";
import { defaultSaveContext } from "../../src/core/loader.js";
import { TurnOptions } from "../../src/model/index.js";
import { enrich, mapModel } from "../../src/model/discovery.js";
import { ModelInfo } from "../../src/model/contracts/models/model-info.js";
// Drill transport bind: the OpenAI executor checks `connection instanceof
// ApiKeyConnection` against the built `@prompty/core` package (dist), whose class
// identity differs from the `../../src` core imported above. The drill agent must
// therefore be constructed from the dist package so the executor recognizes its
// key connection. This cross-core seam is a per-runtime roster detail, not an
// emitter concern.
import {
  Agent as DrillAgent,
  LoadContext as DrillLoadContext,
  Message as DrillMessage,
} from "@prompty/core";
import {
  buildChatArgs as openaiBuildChatArgs,
  buildEmbeddingArgs as openaiBuildEmbeddingArgs,
  buildImageArgs as openaiBuildImageArgs,
  buildResponsesArgs as openaiBuildResponsesArgs,
  OpenAIExecutor,
  OpenAIProcessor,
  processResponse as openaiProcessResponse,
} from "@prompty/openai";
import {
  AnthropicProcessor,
  buildChatArgs as anthropicBuildChatArgs,
} from "@prompty/anthropic";
import { CassetteReplayServer } from "./drill-replay.js";

// The pipeline drives renderer/parser lookups through the registry; register the
// built-ins once so the render/parse adapters exercise the real runtime path.
registerRenderer("nunjucks", new NunjucksRenderer());
registerRenderer("jinja2", new NunjucksRenderer());
registerRenderer("mustache", new MustacheRenderer());
registerParser("prompty", new PromptyChatParser());

export const rendererProvider = {
  jinja2: {
    async render(
      agent: Agent,
      template: string,
      inputs: Record<string, unknown>,
    ): Promise<string> {
      attachThreadInputs(agent, inputs);
      return new NunjucksRenderer().render(agent, template, inputs);
    },
    async renderSegments(
      _agent: Agent,
      template: string,
      inputs: Record<string, unknown>,
    ): Promise<ReturnType<typeof renderSegments>> {
      return renderSegments(template, inputs, []);
    },
  },
  mustache: {
    async render(
      agent: Agent,
      template: string,
      inputs: Record<string, unknown>,
    ): Promise<string> {
      attachThreadInputs(agent, inputs);
      return new MustacheRenderer().render(agent, template, inputs);
    },
    async renderSegments(
      _agent: Agent,
      template: string,
      inputs: Record<string, unknown>,
    ): Promise<ReturnType<typeof renderSegments>> {
      return renderSegments(template, inputs, []);
    },
  },
};

export const parserProvider = {
  prompty: new PromptyChatParser(),
};

export const processorProvider = {
  openai: {
    process: (agent: Agent, response: unknown) =>
      new OpenAIProcessor().process(agent, response),
    processStream: (agent: Agent, stream: unknown) =>
      Promise.resolve(openaiProcessResponse(agent, stream)),
  },
  azure: {
    process: (agent: Agent, response: unknown) =>
      new OpenAIProcessor().process(agent, response),
    processStream: (agent: Agent, stream: unknown) =>
      Promise.resolve(openaiProcessResponse(agent, stream)),
  },
  custom: new AnthropicProcessor(),
};

type AdapterContext = {
  contract: string;
  operation: string;
  vector: Record<string, any>;
  provider?: string;
  targetApi?: string;
  doubles: Record<string, unknown>;
  baseDir: string;
  resolveInput: (value: unknown) => unknown;
};

function attachThreadInputs(
  agent: Agent,
  inputs: Record<string, unknown>,
): void {
  const threadProps = Object.entries(inputs)
    .filter(
      ([, value]) =>
        value !== null &&
        typeof value === "object" &&
        (value as Record<string, unknown>)._kind === "thread",
    )
    .map(([name]) => new Property({ name, kind: "thread" }));
  if (threadProps.length > 0) {
    agent.inputs = threadProps;
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function findSpecFixtures(start: string): string {
  let dir = start;
  for (let i = 0; i < 16; i += 1) {
    const candidate = join(dir, "spec", "fixtures");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate spec/fixtures from vector-adapters.ts");
}

const SPEC_FIXTURES = findSpecFixtures(resolve(import.meta.dirname));

// ---------------------------------------------------------------------------
// Shared normalization
// ---------------------------------------------------------------------------

/**
 * Project `observed` onto the shape of `expected` (subset semantics). Only keys
 * and indices present in `expected` are retained, so partial vectors compare
 * cleanly. Wrong values still fail (projection never fabricates data) and
 * list-length mismatches are preserved so a missing/extra element surfaces as an
 * inequality rather than being truncated away.
 */
function project(observed: any, expected: any): any {
  if (
    expected &&
    typeof expected === "object" &&
    !Array.isArray(expected) &&
    observed &&
    typeof observed === "object" &&
    !Array.isArray(observed)
  ) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(expected)) {
      // Mirror Python's `observed.get(key)` — a key absent from the observed
      // object projects to null (not undefined) so it serializes and compares
      // against an explicit `null` in the vector's expected shape.
      const ov = observed[key] === undefined ? null : observed[key];
      out[key] = project(ov, expected[key]);
    }
    return out;
  }
  if (Array.isArray(expected) && Array.isArray(observed)) {
    if (observed.length !== expected.length) return observed;
    return observed.map((o, i) => project(o, expected[i]));
  }
  return observed;
}

function projectNormalize(observed: unknown, context: AdapterContext): unknown {
  return project(observed, context.vector.expected);
}

// ---------------------------------------------------------------------------
// LOAD
// ---------------------------------------------------------------------------

/**
 * Bridge `Agent.save()` output to the canonical cross-runtime shape. The
 * generated model serializes inputs/outputs/tools as name-keyed maps and omits
 * the implicit `kind`; the vectors use ordered `[{name, ...}]` lists and an
 * explicit `kind: "prompt"`.
 */
function named(name: string, props: any): Record<string, unknown> {
  if (props && typeof props === "object" && !Array.isArray(props)) {
    return { name, ...props };
  }
  return { name, value: props };
}

function toolToCanonical(name: string, spec: any): Record<string, unknown> {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { name, value: spec };
  }
  const tool: Record<string, any> = { name, ...spec };
  const params = tool.parameters;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    tool.parameters = Object.entries(params).map(([pname, pprops]) =>
      named(pname, pprops),
    );
  }
  return tool;
}

function agentToCanonical(saved: Record<string, any>): Record<string, unknown> {
  const out: Record<string, any> = { kind: "prompt", ...saved };
  if (typeof out.instructions === "string") {
    out.instructions = out.instructions
      .replace(/\r\n/g, "\n")
      .replace(/\n+$/, "");
  }
  for (const field of ["inputs", "outputs"]) {
    const value = out[field];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[field] = Object.entries(value).map(([name, props]) =>
        named(name, props),
      );
    }
  }
  const tools = out.tools;
  if (tools && typeof tools === "object" && !Array.isArray(tools)) {
    out.tools = Object.entries(tools).map(([name, spec]) =>
      toolToCanonical(name, spec),
    );
  }
  return out;
}

function saveCanonical(agent: Agent): Record<string, unknown> {
  return agentToCanonical(
    agent.save(defaultSaveContext({ useShorthand: false })),
  );
}

function writePrompty(
  path: string,
  frontmatter: Record<string, any>,
  files?: Record<string, unknown>,
): void {
  if (files) {
    for (const [rel, content] of Object.entries(files)) {
      const target = join(dirname(path), rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        target,
        typeof content === "string" ? content : JSON.stringify(content),
        "utf8",
      );
    }
  }
  let body = "";
  const fm = { ...frontmatter };
  if ("instructions" in fm) {
    body = (fm.instructions as string) ?? "";
    delete fm.instructions;
  }
  const text = `---\n${yamlStringify(fm)}---\n${body}`;
  writeFileSync(path, text, "utf8");
}

function makeAgentFromFrontmatter(frontmatter: Record<string, any>): Agent {
  const data = { ...frontmatter };
  if (
    data.inputs &&
    typeof data.inputs === "object" &&
    !Array.isArray(data.inputs) &&
    data.inputs.properties
  ) {
    data.inputs = data.inputs.properties;
  }
  if (
    data.outputs &&
    typeof data.outputs === "object" &&
    !Array.isArray(data.outputs) &&
    data.outputs.properties
  ) {
    data.outputs = data.outputs.properties;
  }
  return Agent.load(data, new LoadContext());
}

function loadInvoke(input: any, _context: AdapterContext): unknown {
  const envVars: Record<string, string> = input.env ?? {};
  const oldEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envVars)) {
    oldEnv[k] = process.env[k];
    process.env[k] = v;
  }

  try {
    // --- input-validation vectors ---
    // Discriminate structurally: validation vectors carry BOTH a top-level
    // `inputs` map and a `frontmatter`; full-load vectors nest inputs inside
    // the frontmatter. On a missing required input, `validateInputs` throws a
    // typed `PromptyLoadError` whose `typraVector` the harness classifies.
    if (input.inputs !== undefined && input.frontmatter !== undefined) {
      const agent = makeAgentFromFrontmatter(input.frontmatter);
      return { validated_inputs: validateInputs(agent, input.inputs ?? {}) };
    }

    const base = mkdtempSync(join(tmpdir(), "prompty-vec-"));
    try {
      if ("fixture" in input) {
        return saveCanonical(load(join(SPEC_FIXTURES, input.fixture)));
      }
      if ("frontmatter_raw" in input) {
        const p = join(base, "vector.prompty");
        writeFileSync(p, input.frontmatter_raw, "utf8");
        return saveCanonical(load(p));
      }
      const sub = input.agent_subdir ? join(base, input.agent_subdir) : base;
      mkdirSync(sub, { recursive: true });
      const p = join(sub, "vector.prompty");
      writePrompty(p, input.frontmatter, input.files);
      return saveCanonical(load(p));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  } finally {
    for (const [k, v] of Object.entries(oldEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function loadNormalize(observed: unknown, context: AdapterContext): unknown {
  const expected =
    "expectedError" in context.vector
      ? (context.vector as { expectedError: unknown }).expectedError
      : context.vector.expected;
  return project(observed, expected);
}

function seamDiscriminator(input: any, ...path: string[]): string {
  let node = input && typeof input === "object" ? input.agent : undefined;
  for (const key of path) {
    if (!node || typeof node !== "object") {
      node = undefined;
      break;
    }
    node = node[key];
  }
  if (typeof node === "string" && node.length > 0) {
    return node;
  }
  const dotted = ["agent", ...path].join(".");
  throw new Error(
    `vector input missing @dispatch discriminator at '${dotted}'; every conformance vector must nest the discriminator under the seam-param path (no flat-sibling fallback).`,
  );
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PARSE
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// WIRE (toRequest)
// ---------------------------------------------------------------------------

function makeAgentForWire(input: any): Agent {
  const provider = seamDiscriminator(input, "model", "provider");
  const model = new Model({
    id: input.model_id,
    provider,
    apiType: input.apiType,
  });
  const opts = input.options ?? {};
  model.options = new ModelOptions({
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    topP: opts.topP,
    topK: opts.topK,
    frequencyPenalty: opts.frequencyPenalty,
    presencePenalty: opts.presencePenalty,
    seed: opts.seed,
    stopSequences: opts.stopSequences,
    additionalProperties: opts.additionalProperties,
  });

  const agent = new Agent({ name: "wire_test", model: model.id });
  agent.model = model;

  if (input.tools && input.tools.length > 0) {
    agent.tools = input.tools.map((t: any) => {
      const params = (t.parameters ?? []).map((p: any) => Property.load(p));
      const bindings = Object.entries(t.bindings ?? {}).map(
        ([bname, bval]: [string, any]) =>
          new Binding({
            name: bname,
            input: typeof bval === "object" ? bval.input : String(bval),
          }),
      );
      return new FunctionTool({
        name: t.name,
        kind: "function",
        description: t.description,
        parameters: params,
        bindings: bindings.length > 0 ? bindings : undefined,
        strict: t.strict,
      });
    });
  }

  if (input.outputs && input.outputs.length > 0) {
    agent.outputs = input.outputs.map((o: any) => Property.load(o));
  }

  return agent;
}

function vecMessagesToRuntime(messages: any[]): Message[] {
  return (messages ?? []).map((m: any) => {
    const parts = (m.content ?? []).map((c: any) => {
      const kind = c.kind ?? "text";
      if (kind === "image")
        return { kind: "image", source: c.value, mediaType: c.mediaType };
      if (kind === "audio")
        return { kind: "audio", source: c.value, mediaType: c.mediaType };
      return { kind: "text", value: c.value ?? "" };
    });
    return new Message({ role: m.role, parts });
  });
}

function wireInvoke(input: any, _context: AdapterContext): unknown {
  const provider = seamDiscriminator(input, "model", "provider");
  const apiType = input.apiType ?? "chat";
  const messages = vecMessagesToRuntime(input.messages);
  const agent = makeAgentForWire(input);

  let body: Record<string, unknown>;
  if (provider === "anthropic") {
    if (apiType !== "chat") {
      throw new Error(`Anthropic only supports chat apiType, got ${apiType}`);
    }
    body = anthropicBuildChatArgs(agent, messages);
  } else if (apiType === "embedding") {
    body = openaiBuildEmbeddingArgs(agent, messages);
  } else if (apiType === "image") {
    body = openaiBuildImageArgs(agent, messages);
  } else if (apiType === "responses") {
    body = openaiBuildResponsesArgs(agent, messages);
  } else if (apiType === "chat") {
    body = openaiBuildChatArgs(agent, messages);
  } else {
    throw new Error(`Unknown apiType for wire: ${apiType}`);
  }
  return { request_body: body };
}

// ---------------------------------------------------------------------------
// PROCESS
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TurnConformance.replay
//
// Drives the real ReferenceTurnRunner over the deterministic replay scenarios
// and normalizes the emitted journal to the canonical event-string stream. The
// per-scenario model is a scripted double keyed by scenario name — these are
// deterministic *replay* vectors whose model behavior is defined by the
// scenario, exactly as the shared conformance harness intends.
// ---------------------------------------------------------------------------

function replayModelForScenario(
  name: string,
): (request: any) => TurnModelResponse {
  return (request: any): TurnModelResponse => {
    if (name === "no_tool") {
      return new TurnModelResponse({
        output: { text: `hello ${request.inputs.name}` },
        checkpointState: { stable: true },
      });
    }
    if (request.iteration === 0) {
      const toolName = name === "tool_failure" ? "fail" : "add";
      return new TurnModelResponse({
        toolRequests: [
          new HostToolRequest({
            requestId: "exec-1",
            toolCallId: "call-1",
            toolName,
            arguments: { a: 2, b: 3 },
          }),
        ],
      });
    }
    return new TurnModelResponse({
      output: {
        toolResult: request.toolResults[0].result,
        errorKind: request.toolResults[0].errorKind,
      },
    });
  };
}

function replayRecords(path: string): any[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function replayNormalizeJournal(records: any[]): string[] {
  const normalized: string[] = [];
  for (const record of records) {
    if (record.kind === "summary") {
      const s = record.summary;
      normalized.push(
        `summary:${s.sessionId}:${s.status}:turns=${s.turns}:checkpoints=${s.checkpoints}`,
      );
      continue;
    }
    const event = record.event;
    if (record.kind === "session") {
      if (event.type === "session_end") {
        normalized.push(
          `session:${event.type}:${event.sessionId}:${event.turnId}:${event.payload.status}`,
        );
      } else {
        normalized.push(
          `session:${event.type}:${event.sessionId}:${event.turnId}`,
        );
      }
      continue;
    }
    const payload = event.payload ?? {};
    switch (event.type) {
      case "permission_requested":
        normalized.push(
          `turn:${event.type}:${event.iteration}:${payload.requestId}`,
        );
        break;
      case "permission_completed":
        normalized.push(
          `turn:${event.type}:${event.iteration}:${String(payload.approved).toLowerCase()}`,
        );
        break;
      case "tool_execution_start":
        normalized.push(
          `turn:${event.type}:${event.iteration}:${payload.toolName}`,
        );
        break;
      case "tool_execution_complete":
      case "tool_result": {
        let value = `turn:${event.type}:${event.iteration}:${payload.toolName}:${String(
          payload.success,
        ).toLowerCase()}`;
        if (payload.errorKind) value = `${value}:${payload.errorKind}`;
        normalized.push(value);
        break;
      }
      case "error":
        normalized.push(
          `turn:${event.type}:${event.iteration}:${payload.errorKind}`,
        );
        break;
      case "turn_end":
        normalized.push(
          `turn:${event.type}:${event.iteration}:${payload.status}`,
        );
        break;
      default:
        normalized.push(`turn:${event.type}:${event.iteration}`);
    }
  }
  return normalized;
}

async function replayInvoke(
  input: any,
  context: AdapterContext,
): Promise<string[]> {
  const name = context.vector.name;
  const base = mkdtempSync(join(tmpdir(), "prompty-replay-"));
  try {
    const journalPath = join(base, `${name}.jsonl`);
    let idIndex = 0;
    const nextId = (prefix: string): string => {
      idIndex += 1;
      return `${prefix}-${idIndex}`;
    };
    const fail = (): unknown => {
      throw new Error("boom");
    };
    const runner = new ReferenceTurnRunner({
      eventSink: new CollectingEventSink(),
      journal: new JsonlEventJournalWriter(journalPath),
      checkpointStore: new InMemoryCheckpointStore(),
      permissionResolver:
        name === "permission_denied"
          ? new DenyAllPermissionResolver()
          : new AllowAllPermissionResolver(),
      hostToolExecutor: new FunctionHostToolExecutor({
        add: (args: any) => Number(args.a) + Number(args.b),
        fail,
      }),
      invokeModel: replayModelForScenario(name),
      now: () => input.clock,
      nextId,
    });
    await runner.run(
      new RunTurnRequest({
        sessionId: input.sessionId,
        turnId: input.turnId,
        inputs: input.inputs,
        options: new TurnOptions({ maxIterations: input.maxIterations }),
      }),
    );
    return replayNormalizeJournal(replayRecords(journalPath));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// DiscoveryConformance adapters
// ---------------------------------------------------------------------------

function discoveryEnrichInvoke(
  input: unknown,
  context: AdapterContext,
): Record<string, unknown> {
  const provider = context.provider ?? "";
  const base = ModelInfo.load(input as Record<string, unknown>);
  return enrich(base, provider).save();
}

function discoveryMapInvoke(
  input: unknown,
  context: AdapterContext,
): Record<string, unknown> {
  const provider = context.provider ?? "";
  return mapModel(input, provider).save();
}

// ---------------------------------------------------------------------------
// Processor.processStream — provider stream classification + reconciliation
// ---------------------------------------------------------------------------

/**
 * Drive one `processStream` vector through the REAL provider stream classifier
 * and the provider-agnostic reconciler.
 *
 * The vector's raw events are replayed as the provider's async response
 * iterator (a `transportError` event becomes a thrown error mid-stream, exactly
 * as a dropped SSE connection surfaces). `@prompty/openai`'s `processResponse`
 * classifies them into text / determinate-refusal / indeterminate-transport
 * chunks, and core's `reconcileStream` reduces that sequence identically for
 * every provider. Nothing about the contract is recomputed in the adapter.
 */

// ---------------------------------------------------------------------------
// TurnConformance.run — provider-agnostic agent loop
// ---------------------------------------------------------------------------

/**
 * Replay a vector's `sequence` as the agent loop's model callback.
 *
 * Each `invoke` returns the next scripted `llm_response` translated to a
 * provider-agnostic `ModelResponse`, and records that step's `tool_results` so
 * `dispatch` can return them by `tool_call_id`. The engine only ever sees
 * normalized model turns and tool outputs — never any provider or fixture
 * knowledge.
 */
class ScriptedModel {
  private index = 0;
  private results: Record<string, unknown> = {};

  constructor(private readonly sequence: any[]) {}

  invoke = (): ModelResponse => {
    const step = this.sequence[this.index];
    this.index += 1;
    const message = step.llm_response.choices[0].message;
    const rawToolCalls = message.tool_calls ?? null;
    const toolCalls: AgentToolCall[] = (rawToolCalls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name ?? "",
      arguments: tc.function?.arguments ?? "",
    }));
    this.results = {};
    for (const tr of step.tool_results ?? []) {
      this.results[tr.tool_call_id] = tr.result;
    }
    return {
      content: message.content ?? null,
      toolCalls,
      rawToolCalls,
    };
  };

  dispatch = (call: AgentToolCall): string => {
    const value = this.results[call.id];
    return value == null ? "" : String(value);
  };
}

/**
 * Return the scripted compaction summary from a vector's expectation.
 *
 * The compaction summary is a model output; in conformance the model is
 * scripted, but the summary has no dedicated slot in `sequence` today, so it is
 * sourced from `expected.trimmed_messages` (the summary system message). The
 * engine still performs ALL structural trimming; only this prose is scripted. A
 * dedicated summary input slot is the recommended TypeSpec follow-up.
 */
function runScriptedSummary(expected: any): string | null {
  for (const message of expected.trimmed_messages ?? []) {
    const content = message.content;
    if (typeof content === "string" && content.startsWith(SUMMARY_PREFIX)) {
      return content;
    }
  }
  return null;
}

/** Build the three optional guardrail callbacks from vector flags. */
function runGuardrails(flags: any): {
  inputGuardrail: ((c: any[]) => AgentGuardrailDecision) | null;
  outputGuardrail: ((r: ModelResponse) => AgentGuardrailDecision) | null;
  toolGuardrail: ((n: string, a: any) => AgentGuardrailDecision) | null;
} {
  const guardrails = flags.guardrails ?? {};
  let inputGuardrail: ((c: any[]) => AgentGuardrailDecision) | null = null;
  let outputGuardrail: ((r: ModelResponse) => AgentGuardrailDecision) | null =
    null;
  let toolGuardrail: ((n: string, a: any) => AgentGuardrailDecision) | null =
    null;

  const inputCfg = guardrails.input;
  if (inputCfg != null) {
    inputGuardrail = () =>
      inputCfg.action === "deny"
        ? { allowed: false, reason: inputCfg.reason }
        : { allowed: true };
  }

  const outputCfg = guardrails.output;
  if (outputCfg != null) {
    outputGuardrail = () =>
      outputCfg.action === "deny"
        ? { allowed: false, reason: outputCfg.reason }
        : { allowed: true };
  }

  const toolCfg = guardrails.tool;
  if (toolCfg != null) {
    const deny = new Set<string>(toolCfg.deny_tools ?? []);
    const reason = toolCfg.reason;
    toolGuardrail = (name: string) =>
      deny.has(name) ? { allowed: false, reason } : { allowed: true };
  }

  return { inputGuardrail, outputGuardrail, toolGuardrail };
}

function firstMessage(
  conversation: any[],
  predicate: (m: any) => boolean,
): any | null {
  for (const message of conversation) {
    if (predicate(message)) return message;
  }
  return null;
}

/** Drive the provider-agnostic agent loop for one `run` vector. */
async function runInvoke(
  input: any,
  context: AdapterContext,
): Promise<Record<string, unknown>> {
  const flags = input;
  const expected = context.vector.expected;

  const messages = (flags.messages ?? []).map((m: any) => ({ ...m }));
  const toolFunctions = flags.tool_functions ?? {};
  const sequence = context.vector.sequence ?? [];

  const model = new ScriptedModel(sequence);
  const { inputGuardrail, outputGuardrail, toolGuardrail } =
    runGuardrails(flags);

  const steeringCfg = flags.steering?.messages ?? [];
  const steering: AgentSteeringMessage[] = steeringCfg.map((item: any) => ({
    injectBeforeIteration: item.inject_before_iteration,
    role: item.role ?? "user",
    text: item.text,
  }));

  const cancelAt = flags.cancel?.cancelled_at ?? null;
  const contextBudget = flags.context_budget ?? null;
  const summary = runScriptedSummary(expected);
  const summarize = summary != null ? () => summary : null;

  const result = await runAgentLoop(messages, {
    invokeModel: model.invoke,
    dispatchTool: model.dispatch,
    isToolRegistered: (name: string) =>
      Object.prototype.hasOwnProperty.call(toolFunctions, name),
    inputGuardrail,
    outputGuardrail,
    toolGuardrail,
    steering,
    cancelAt,
    contextBudget,
    summarize,
  });

  const observed: Record<string, unknown> = {
    result: result.result,
    iterations: result.iterations,
    total_messages: totalMessages(result),
    message_sequence: result.conversation,
    tools_executed: result.toolsExecuted,
    tool_execution_order: result.toolExecutionOrder,
    denied_tools: result.deniedTools,
    trimmed_messages: result.trimmedMessages,
    events: result.events,
  };

  const assistantTc = firstMessage(
    result.conversation,
    (m) =>
      m.role === "assistant" &&
      m.metadata != null &&
      typeof m.metadata === "object" &&
      "tool_calls" in m.metadata,
  );
  if (assistantTc != null) {
    observed.assistant_tool_calls_message = assistantTc;
  }

  const toolMsg = firstMessage(result.conversation, (m) => m.role === "tool");
  if (toolMsg != null) {
    observed.tool_result_message = {
      role: "tool",
      content: [{ type: "text", text: toolMsg.content }],
      metadata: toolMsg.metadata,
    };
  }

  if (result.error != null) observed.error = result.error;
  if (result.errorType != null) observed.error_type = result.errorType;
  if (result.errorReason != null) observed.error_reason = result.errorReason;

  // Annotation passthrough — cross-runtime notes that are not TS behavioral
  // observations. Echo them so canonical equality holds without fabricating
  // engine output.
  for (const annotation of [
    "notes",
    "summary_contains",
    "rust_expected_error",
  ]) {
    if (annotation in expected) observed[annotation] = expected[annotation];
  }

  return observed;
}

/**
 * Subsequence-match observed events against the expected event list.
 *
 * For each expected event (in order) scan forward for the next observed event
 * of the same `type`, then project its `data` to the expected keys (or drop
 * `data` entirely when the expected event is type-only). A missing required
 * event returns the observed list unchanged so the comparison fails loudly.
 */
function runMatchEvents(observedEvents: any[], expectedEvents: any[]): any[] {
  const matched: any[] = [];
  let index = 0;
  for (const expected of expectedEvents) {
    const expectedType = expected.type;
    let found: any = null;
    while (index < observedEvents.length) {
      const candidate = observedEvents[index];
      index += 1;
      if (candidate.type === expectedType) {
        found = candidate;
        break;
      }
    }
    if (found == null) return observedEvents;
    if ("data" in expected) {
      matched.push({
        type: expectedType,
        data: project(found.data, expected.data),
      });
    } else {
      matched.push({ type: expectedType });
    }
  }
  return matched;
}

function runNormalize(observed: any, context: AdapterContext): unknown {
  const expected = context.vector.expected;
  if (
    observed == null ||
    typeof observed !== "object" ||
    Array.isArray(observed) ||
    expected == null ||
    typeof expected !== "object"
  ) {
    return observed;
  }
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(expected)) {
    if (key === "events") {
      projected[key] = runMatchEvents(observed.events ?? [], expected.events);
    } else {
      projected[key] = project(observed[key], expected[key]);
    }
  }
  return projected;
}

// ---------------------------------------------------------------------------
// TurnConformance.runTurn — provider-agnostic snapshot/portability turn engine
// ---------------------------------------------------------------------------

/**
 * Drive the provider-agnostic turn engine for one `runTurn` vector.
 *
 * The vector scripts the model as an ordered `model` array (each entry is a
 * tool round `{tools, nextPortability?, delegatedState?}` or a final answer
 * `{output}`), `toolOutputs` by tool-call id, `denyTools` for the permission
 * gate, and `cancelBeforeRun`. All snapshot/portability/event accounting lives
 * in the engine.
 */
async function runTurnInvoke(
  input: any,
  _context: AdapterContext,
): Promise<Record<string, unknown>> {
  const flags = input;
  const messages = (flags.messages ?? []) as Record<string, unknown>[];
  const scripted = (flags.model ?? []) as any[];
  const toolOutputs = flags.toolOutputs ?? {};
  const denyTools = new Set<string>(flags.denyTools ?? []);
  const cancelBeforeRun = Boolean(flags.cancelBeforeRun);

  const invokeModel = (
    iteration: number,
    _toolResults: TurnToolResult[],
  ): TurnModelTurn => {
    const turn = scripted[iteration];
    const toolCalls: TurnToolCall[] = (turn.tools ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments ?? {},
    }));
    return {
      output: turn.output,
      toolCalls,
      nextPortability: turn.nextPortability ?? null,
      delegatedState: turn.delegatedState ?? null,
    };
  };

  const result = await runTurnEngine(messages, {
    invokeModel,
    resolvePermission: (call: TurnToolCall) => !denyTools.has(call.name),
    executeTool: (call: TurnToolCall) => toolOutputs[call.id] ?? null,
    cancelBeforeRun,
  });

  return {
    status: result.status,
    output: result.output,
    iterations: result.iterations,
    snapshots: result.snapshots,
    snapshotStablePrefixes: result.snapshotStablePrefixes,
    snapshotPortability: result.snapshotPortability,
    commitPortability: result.commitPortability,
    delegatedState: result.delegatedStateCount,
    toolResults: result.toolResults.length,
    toolResultOrder: result.toolResultOrder,
    eventKinds: result.events,
  };
}

// ---------------------------------------------------------------------------
// LiveChatConformance.complete -- the service-drill adapter
// ---------------------------------------------------------------------------
//
// A "drill" is a conformance vector that crosses the REAL Executor transport
// seam. Unlike the pure conformance vectors that stop at the SDK edge, the drill
// binds the seam via base-URL redirect -- to a local `CassetteReplayServer`
// (replay mode) or the real base URL (live mode) -- and asserts three planes:
//
//   1. transport -- the seam was reached and returned bytes (executor got a
//      response, and the replay server captured an inbound request).
//   2. wire      -- the outbound provider request body matches the cassette's
//      recorded request body (canonical equality; throw on mismatch).
//   3. semantic  -- normalized executor output == the vector `expected`. This
//      plane is asserted by the RUNNER via the registered `normalize`, so the
//      drill's semantic plane IS a conformance vector over the executor.
//
// In live mode the adapter additionally asserts live-semantic == replay-semantic
// (parity). `requires` is deliberately OMITTED from the drill vector -- the
// `requires` guard is all-or-nothing and would skip the WHOLE vector when creds
// are absent, defeating the replay plane. Instead the adapter self-gates the
// live plane on credential presence and always runs replay.
//
// Cassette bytes and the SDK transport binding are consumer-owned "roster" -- by
// design NOT modeled in TypeSpec/Typra. This is the TypeScript counterpart of
// the Python runtime's drill adapter in `tests/model/vector_adapters.py`.

const DRILL_REPLAY_API_KEY = "sk-drill-replay-placeholder";
const DRILL_FINISH_REASONS = new Set([
  "stop",
  "length",
  "tool_calls",
  "content_filter",
  "function_call",
]);

/** Order-insensitive canonical JSON for wire/parity equality checks. */
function drillCanonical(value: unknown): string {
  const sort = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sort);
    if (node !== null && typeof node === "object") {
      const src = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) out[key] = sort(src[key]);
      return out;
    }
    return node;
  };
  return JSON.stringify(sort(value));
}

/**
 * Construct a chat `Agent` bound to a specific transport `endpoint`.
 *
 * The drill binds the transport seam via base-URL redirect, so `endpoint` and
 * `apiKey` are supplied by the caller (a local cassette-replay server in replay
 * mode, the real base URL + key in live mode) rather than read from the vector
 * input. When `endpoint` is falsy the connection omits it so the SDK falls back
 * to the provider's default base URL (live mode without an override).
 */
function drillBuildAgent(
  input: any,
  opts: { endpoint?: string | null; apiKey?: string | null },
): DrillAgent {
  const provider = (input.provider ?? "openai").toLowerCase();
  const connection: Record<string, unknown> = { kind: "key" };
  if (opts.apiKey) connection.apiKey = opts.apiKey;
  if (opts.endpoint) connection.endpoint = opts.endpoint;

  const model: Record<string, unknown> = {
    id: input.model ?? "gpt-4o-mini",
    provider,
    apiType: "chat",
    connection,
  };
  if (input.options) model.options = input.options;

  return DrillAgent.load(
    { name: "drill-chat-vector", model },
    new DrillLoadContext(),
  );
}

function drillBuildMessages(input: any): DrillMessage[] {
  return ((input.messages ?? []) as any[]).map(
    (spec) =>
      new DrillMessage({
        role: spec.role ?? "user",
        parts: [{ kind: "text", value: spec.content ?? "" }],
      }),
  );
}

/**
 * Drive the real executor with its transport bound to `endpoint`. Returns the
 * raw provider response. Shared by the replay path (`endpoint` = a
 * `CassetteReplayServer` base URL) and the live path (`endpoint` = the real
 * base URL or null for the SDK default).
 */
async function drillExecute(
  input: any,
  opts: { endpoint?: string | null; apiKey?: string | null },
): Promise<unknown> {
  const agent = drillBuildAgent(input, opts);
  const messages = drillBuildMessages(input);
  return new OpenAIExecutor().execute(agent, messages);
}

/** Reduce a raw provider chat response to `{ role, content, finish }`. */
function drillExtractChatStructure(observed: any): {
  role: unknown;
  content: unknown;
  finish: unknown;
} {
  const choices = observed?.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0];
    const message = choice?.message;
    return {
      role: message?.role,
      content: message?.content,
      finish: choice?.finish_reason,
    };
  }
  return {
    role: observed?.role,
    content: observed?.content,
    finish: observed?.stop_reason,
  };
}

/** Project a raw chat response onto the canonical structural shape. */
function drillNormalizeResponse(observed: unknown): {
  role: unknown;
  contentNonEmpty: boolean;
  finishReasonInEnum: boolean;
} {
  const { role, content, finish } = drillExtractChatStructure(observed);
  return {
    role,
    contentNonEmpty: typeof content === "string" && content.trim().length > 0,
    finishReasonInEnum: DRILL_FINISH_REASONS.has(finish as string),
  };
}

/**
 * Live plane is enabled iff a base URL AND an API key resolved from env.
 * `$env` refs resolve to "" when unset, so this is false in replay-only
 * (no-creds) runs and true only when the vector's endpoint+apiKey env vars are
 * both populated.
 */
function drillLiveEnabled(input: any): boolean {
  return Boolean(input.endpoint && input.apiKey);
}

/**
 * Run the drill: bind transport, replay the cassette, assert 3 planes. Returns
 * the raw replay response; the runner then applies `normalize` and compares
 * against the vector `expected` (the semantic plane).
 */
async function drillInvoke(
  input: any,
  context: AdapterContext,
): Promise<unknown> {
  const vector = (context.vector ?? {}) as Record<string, unknown>;
  const exchangeRaw = (vector.exchange ?? {}) as Record<string, unknown>;
  // The runner resolves refs only on `input`; the adapter owns `exchange`
  // resolution (nested `$env` transport ref + `$json` cassette ref).
  const exchange = context.resolveInput(exchangeRaw) as Record<string, unknown>;

  const cassette = (exchange.cassette ?? {}) as Record<string, unknown>;
  const cassetteRequest = (cassette.request ?? {}) as Record<string, unknown>;
  const cassetteResponse = (cassette.response ?? {}) as Record<string, unknown>;
  const recordedRequest = cassetteRequest.body;
  const recordedResponse = cassetteResponse.body;
  const recordedStatus = Number(cassetteResponse.status ?? 200);
  if (recordedResponse === undefined) {
    throw new Error("drill cassette missing response.body");
  }

  // --- Replay: bind the transport to the local cassette server -------------
  const server = new CassetteReplayServer(recordedResponse, recordedStatus);
  let raw: unknown;
  await server.start();
  try {
    raw = await drillExecute(input, {
      endpoint: server.baseUrl,
      apiKey: DRILL_REPLAY_API_KEY,
    });

    // Plane 1: transport -- the seam was reached and a request was captured.
    const captured = server.lastRequest;
    if (captured === null) {
      throw new Error(
        "drill transport plane: no request reached the replay server",
      );
    }
    if (raw === null || raw === undefined) {
      throw new Error("drill transport plane: executor returned no response");
    }

    // Plane 2: wire -- outbound request body matches the cassette request.
    if (recordedRequest !== undefined) {
      const observedBody = captured.body;
      if (drillCanonical(observedBody) !== drillCanonical(recordedRequest)) {
        throw new Error(
          "drill wire plane mismatch:\n" +
            `  observed=${drillCanonical(observedBody)}\n` +
            `  cassette=${drillCanonical(recordedRequest)}`,
        );
      }
    }
  } finally {
    await server.stop();
  }

  // --- Live parity (self-gated): live-semantic must equal replay-semantic ---
  if (drillLiveEnabled(input)) {
    const liveRaw = await drillExecute(input, {
      endpoint: input.endpoint || null,
      apiKey: input.apiKey,
    });
    if (
      drillCanonical(drillNormalizeResponse(liveRaw)) !==
      drillCanonical(drillNormalizeResponse(raw))
    ) {
      throw new Error(
        "drill live/replay parity mismatch:\n" +
          `  live=${drillCanonical(drillNormalizeResponse(liveRaw))}\n` +
          `  replay=${drillCanonical(drillNormalizeResponse(raw))}`,
      );
    }
  }

  // Plane 3 (semantic) is asserted by the runner: normalize(raw) == expected.
  return raw;
}

/** Registered semantic projection: raw response -> canonical structure. */
function drillNormalize(observed: unknown, _context: AdapterContext): unknown {
  return drillNormalizeResponse(observed);
}

// ---------------------------------------------------------------------------
// Adapter registry
// ---------------------------------------------------------------------------

export const vectorAdapters = {
  "LoadConformance.load": { invoke: loadInvoke, normalize: loadNormalize },
  "WireConformance.toRequest": {
    invoke: wireInvoke,
    normalize: projectNormalize,
  },
  "TurnConformance.run": { invoke: runInvoke, normalize: runNormalize },
  "TurnConformance.runTurn": {
    invoke: runTurnInvoke,
    normalize: projectNormalize,
  },
  "TurnConformance.replay": { invoke: replayInvoke },
  "DiscoveryConformance.enrich": { invoke: discoveryEnrichInvoke },
  "DiscoveryConformance.mapModel": { invoke: discoveryMapInvoke },
  "LiveChatConformance.complete": {
    invoke: drillInvoke,
    normalize: drillNormalize,
  },
};

// Every cross-runtime contract now has a real TypeScript adapter above; there
// are no outstanding conformance gaps, so there are no waivers. A removed waiver
// with no adapter fails hard ("@vector conformance never skips silently"), which
// is exactly the signal that these are genuinely satisfied.
export const vectorWaivers: Record<string, string> = {};

export const vectorDoubles: Record<string, unknown> = {};
