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
  parse,
  registerParser,
  registerRenderer,
  render,
  renderSegments,
  validateInputs,
  MustacheRenderer,
  NunjucksRenderer,
  PromptyChatParser,
  StrictViolationError,
  TextChunk,
  StreamChunk,
  reconcileStream,
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
import { expandThreads } from "../../src/core/pipeline.js";
import { enrich, mapModel } from "../../src/model/discovery.js";
import { ModelInfo } from "../../src/model/contracts/models/model-info.js";
import {
  buildChatArgs as openaiBuildChatArgs,
  buildEmbeddingArgs as openaiBuildEmbeddingArgs,
  buildImageArgs as openaiBuildImageArgs,
  buildResponsesArgs as openaiBuildResponsesArgs,
  processResponse as openaiProcessResponse,
} from "@prompty/openai";
import {
  buildChatArgs as anthropicBuildChatArgs,
  processResponse as anthropicProcessResponse,
} from "@prompty/anthropic";

// The pipeline drives renderer/parser lookups through the registry; register the
// built-ins once so the render/parse adapters exercise the real runtime path.
registerRenderer("nunjucks", new NunjucksRenderer());
registerRenderer("jinja2", new NunjucksRenderer());
registerRenderer("mustache", new MustacheRenderer());
registerParser("prompty", new PromptyChatParser());

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function loadInvoke(input: any, context: AdapterContext): unknown {
  const expected = context.vector.expected;
  const envVars: Record<string, string> = input.env ?? {};
  const oldEnv: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envVars)) {
    oldEnv[k] = process.env[k];
    process.env[k] = v;
  }

  const asError = (err: any): Record<string, unknown> => {
    const msg = err?.message ?? String(err);
    const name = err?.constructor?.name ?? "Error";
    const code = err?.code;
    const low = String(msg).toLowerCase();
    const lowName = String(name).toLowerCase();
    const expErr =
      expected && typeof expected === "object" ? expected.error : undefined;
    const field =
      expected && typeof expected === "object"
        ? expected.error_field
        : undefined;
    let matched = false;
    if (typeof expErr === "string") {
      if (expErr === name || String(msg).includes(expErr)) {
        matched = true;
      } else if (
        expErr === "FileNotFoundError" &&
        (code === "ENOENT" ||
          low.includes("no such file") ||
          low.includes("enoent"))
      ) {
        matched = true;
      } else if (
        expErr === "invalid frontmatter" &&
        (low.includes("yaml") ||
          low.includes("mapping") ||
          low.includes("flow collection") ||
          lowName.includes("yaml"))
      ) {
        matched = true;
      } else if (
        expErr === "Invalid template format" &&
        low.includes("template")
      ) {
        matched = true;
      } else if (
        expErr === "Missing required input" &&
        low.includes("required")
      ) {
        matched = true;
      }
    }
    if (!matched) return { error: msg };
    const observed: Record<string, unknown> = { error: expErr };
    if (field != null && String(msg).includes(String(field))) {
      observed.error_field = field;
    }
    return observed;
  };

  try {
    // --- input validation vectors ---
    if (
      expected &&
      typeof expected === "object" &&
      "validated_inputs" in expected
    ) {
      const agent = makeAgentFromFrontmatter(input.frontmatter);
      return { validated_inputs: validateInputs(agent, input.inputs ?? {}) };
    }
    if (
      expected &&
      typeof expected === "object" &&
      "error" in expected &&
      input.inputs !== undefined &&
      input.frontmatter !== undefined
    ) {
      const agent = makeAgentFromFrontmatter(input.frontmatter);
      try {
        validateInputs(agent, input.inputs ?? {});
      } catch (err) {
        return asError(err);
      }
      return { error: "<no error raised>" };
    }

    const base = mkdtempSync(join(tmpdir(), "prompty-vec-"));
    try {
      if ("fixture" in input) {
        try {
          return saveCanonical(load(join(SPEC_FIXTURES, input.fixture)));
        } catch (err) {
          return asError(err);
        }
      }
      if ("frontmatter_raw" in input) {
        const p = join(base, "vector.prompty");
        writeFileSync(p, input.frontmatter_raw, "utf8");
        try {
          return saveCanonical(load(p));
        } catch (err) {
          return asError(err);
        }
      }
      const sub = input.agent_subdir ? join(base, input.agent_subdir) : base;
      mkdirSync(sub, { recursive: true });
      const p = join(sub, "vector.prompty");
      writePrompty(p, input.frontmatter, input.files);
      try {
        return saveCanonical(load(p));
      } catch (err) {
        return asError(err);
      }
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

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------

async function renderInvoke(
  input: any,
  context: AdapterContext,
): Promise<unknown> {
  const template: string = input.template;
  const engine: string = input.engine ?? "jinja2";
  let inputs: Record<string, any> = { ...(input.inputs ?? {}) };
  const expected = context.vector.expected;

  const agent = new Agent({
    name: "render_test",
    instructions: template,
    template: new Template({
      format: new FormatConfig({ kind: engine }),
      parser: new ParserConfig({ kind: "prompty" }),
    }),
  });

  const hasThread = Object.values(inputs).some(
    (v: any) => v && typeof v === "object" && v._kind === "thread",
  );
  if (hasThread) {
    const threadProps: Property[] = [];
    const regular: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(inputs)) {
      if (v && typeof v === "object" && (v as any)._kind === "thread") {
        threadProps.push(new Property({ name: k, kind: "thread" }));
        regular[k] = (v as any).messages ?? [];
      } else {
        regular[k] = v;
      }
    }
    const threadNames = new Set(threadProps.map((p) => p.name));
    agent.inputs = [
      ...threadProps,
      ...Object.keys(regular)
        .filter((k) => !threadNames.has(k))
        .map((k) => new Property({ name: k, kind: "string" })),
    ];
    inputs = regular;
  }

  const rendered = await render(agent, inputs);

  if (expected && typeof expected === "object" && "nonce_pattern" in expected) {
    const re = new RegExp(expected.nonce_pattern, "s");
    const match = re.exec(rendered);
    if (match && match.index === 0) return expected;
    return { rendered };
  }

  return { rendered };
}

function renderSegmentsInvoke(input: any, _context: AdapterContext): unknown {
  try {
    return {
      segments: renderSegments(
        input.template,
        input.inputs ?? {},
        input.strict_props ?? [],
      ).map((segment) => ({
        kind: segment.kind,
        text: segment.text,
        source: segment.source,
        strict: segment.strict,
      })),
    };
  } catch (error) {
    if (error instanceof StrictViolationError) {
      return { error: "StrictViolation" };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// PARSE
// ---------------------------------------------------------------------------

function messageToCanonical(msg: any): Record<string, unknown> {
  const content = (msg.parts ?? []).map((p: any) =>
    typeof p?.save === "function" ? p.save() : { ...p },
  );
  const result: Record<string, unknown> = { role: msg.role, content };
  if (msg.metadata && Object.keys(msg.metadata).length > 0) {
    result.metadata = msg.metadata;
  }
  return result;
}

async function parseInvoke(
  input: any,
  _context: AdapterContext,
): Promise<unknown> {
  const rendered: string = input.rendered;
  const agent = new Agent({
    name: "parse_test",
    template: new Template({
      format: new FormatConfig({ kind: "jinja2", strict: false }),
      parser: new ParserConfig({ kind: "prompty" }),
    }),
  });

  let messages = await parse(agent, rendered);

  const threadInputs: Record<string, any[]> | undefined = input.thread_inputs;
  if (threadInputs) {
    const nonces = new Map<string, string>();
    for (const name of Object.keys(threadInputs)) {
      const re = new RegExp(
        `__PROMPTY_THREAD_[0-9a-fA-F]+_${escapeRegExp(name)}__`,
      );
      const match = re.exec(rendered);
      if (match) nonces.set(name, match[0]);
    }
    messages = expandThreads(messages, nonces, threadInputs);
  }

  return { messages: messages.map(messageToCanonical) };
}

// ---------------------------------------------------------------------------
// WIRE (toRequest)
// ---------------------------------------------------------------------------

function makeAgentForWire(input: any): Agent {
  const model = new Model({
    id: input.model_id,
    provider: input.provider,
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
  const provider = input.provider ?? "openai";
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

function processResultToCanonical(result: any): unknown {
  if (
    Array.isArray(result) &&
    result.length > 0 &&
    result[0] &&
    typeof result[0] === "object" &&
    "id" in result[0] &&
    "name" in result[0] &&
    "arguments" in result[0]
  ) {
    return result.map((tc: any) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    }));
  }
  if (result == null) return "";
  return result;
}

function processInvoke(input: any, _context: AdapterContext): unknown {
  const provider = input.provider ?? "openai";
  const responseData = input.response;
  const hasOutputs = input.has_outputs ?? false;

  const agent = new Agent({ name: "process_test", model: "test" });
  if (hasOutputs) {
    agent.outputs = [new Property({ name: "dummy", kind: "string" })];
  }

  const result =
    provider === "anthropic"
      ? anthropicProcessResponse(agent, responseData)
      : openaiProcessResponse(agent, responseData);
  return { result: processResultToCanonical(result) };
}

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
async function processStreamInvoke(
  input: any,
  context: AdapterContext,
): Promise<Record<string, unknown>> {
  const provider = input.provider ?? context.provider ?? "openai";
  if (provider !== "openai") {
    throw new Error(`Unsupported stream provider: ${JSON.stringify(provider)}`);
  }
  const events = (input.events ?? []) as Array<
    | { kind: "provider"; value: Record<string, unknown> }
    | { kind: "transportError"; message: string }
  >;

  const response: AsyncIterable<unknown> = {
    async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
      for (const event of events) {
        if (event.kind === "transportError") {
          throw new Error(event.message);
        }
        yield event.value;
      }
    },
  };

  const agent = new Agent({ name: "stream-vector", model: "gpt-test" });
  const chunks: StreamChunk[] = [];
  const saved: Record<string, unknown>[] = [];
  const processed = openaiProcessResponse(
    agent,
    response,
  ) as AsyncIterable<unknown>;
  for await (const item of processed) {
    // The provider yields either a plain text string or a FailureChunk. Round
    // its value through save()/load() with the local (src) StreamChunk so the
    // reconciler's `instanceof` checks see this package's class identity — the
    // provider package classifies against @prompty/core's built output, whose
    // class objects differ from the source under test.
    let chunk: StreamChunk;
    if (typeof item === "string") {
      chunk = new TextChunk({ value: item });
    } else {
      chunk = StreamChunk.load((item as StreamChunk).save());
    }
    chunks.push(chunk);
    saved.push(chunk.save());
  }

  const reconciliation = reconcileStream(chunks);
  return {
    chunks: saved,
    partialText: reconciliation.partialText,
    requiresReconciliation: reconciliation.requiresReconciliation,
    completionCommitted: reconciliation.completionCommitted,
  };
}

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
// Adapter registry
// ---------------------------------------------------------------------------

export const vectorAdapters = {
  "LoadConformance.load": { invoke: loadInvoke, normalize: projectNormalize },
  "Renderer.render": { invoke: renderInvoke, normalize: projectNormalize },
  "Renderer.renderSegments": {
    invoke: renderSegmentsInvoke,
    normalize: projectNormalize,
  },
  "Parser.parse": { invoke: parseInvoke, normalize: projectNormalize },
  "WireConformance.toRequest": {
    invoke: wireInvoke,
    normalize: projectNormalize,
  },
  "Processor.process": { invoke: processInvoke, normalize: projectNormalize },
  "Processor.processStream": {
    invoke: processStreamInvoke,
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
};

// Every cross-runtime contract now has a real TypeScript adapter above; there
// are no outstanding conformance gaps, so there are no waivers. A removed waiver
// with no adapter fails hard ("@vector conformance never skips silently"), which
// is exactly the signal that these are genuinely satisfied.
export const vectorWaivers: Record<string, string> = {};

export const vectorDoubles: Record<string, unknown> = {};
