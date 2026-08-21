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
  "TurnConformance.replay": { invoke: replayInvoke },
  "DiscoveryConformance.enrich": { invoke: discoveryEnrichInvoke },
  "DiscoveryConformance.mapModel": { invoke: discoveryMapInvoke },
};

// Contracts the TypeScript runtime does not yet satisfy against the canonical
// spec. Each waiver is an explicit, reasoned conformance gap — NOT a silent
// skip — and is the honest "how done" signal. These mirror the Python
// reference's waivers exactly.
export const vectorWaivers: Record<string, string> = {
  "TurnConformance.run":
    "The run vectors assert a specific agent-loop *accounting and observability* " +
    "contract the TypeScript runtime does not yet match, even though the underlying " +
    "behaviors exist. pipeline.turn() implements guardrails, steering, context " +
    "trimming/compaction, parallel tool rounds, cancellation, and structured events. " +
    "The gap is the observable model the vectors compare against: (1) `iterations` is " +
    "defined as the number of LLM calls, while turn() counts only tool-executing " +
    "rounds; (2) `total_messages` must include the final assistant message, which " +
    "turn() does not append before returning; (3) each vector pins an exact `events` " +
    "schema. Reconciling turn()'s accounting to the canonical convention is real, " +
    "scoped runtime work; recomputing these counts in the adapter would test the " +
    "adapter, not the runtime, so this stays an honest waiver. Same gap as Python.",
  "TurnConformance.runTurn":
    "The runTurn vectors require a snapshot/portability turn engine (stable-prefix " +
    "snapshots, portable vs delegated provider state, delegated_provider_state " +
    "resumption, cancel-before-run) that has no runtime implementation yet — only the " +
    "generated protocol exists. Genuine feature gap. Same gap as Python.",
  "Processor.processStream":
    "The processStream vectors assert streaming-failure classification + " +
    "reconciliation (determinate vs indeterminate failure, preserved partial text, " +
    "requiresReconciliation, completionCommitted). This is a streaming *pipeline* " +
    "behavior (turn() plus the provider stream processor), not a pure model-layer op, " +
    "so it is not wired into this model conformance harness. It is driven against the " +
    "same generated vectors.json by the dedicated runners packages/core " +
    "stream-failures.test.ts (reconciliation via turn()) and packages/openai " +
    "stream-failure-vectors.test.ts (chunk classification via the OpenAI processor).",
};

export const vectorDoubles: Record<string, unknown> = {};
