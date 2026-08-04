import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_TARGETS = [
  "csharp",
  "go",
  "markdown",
  "python",
  "rust",
  "typescript",
];
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const vector = readJson(
  join(repoRoot, "spec", "vectors", "engine", "port_contracts.json"),
);
const surfaces = readJson(
  join(
    repoRoot,
    "schema",
    "tsp-output",
    ".typra-generated",
    "export-surfaces.json",
  ),
);

verifyLegacyHarness();
verifyExportSurfaces();
verifyNoWireCancellation();
verifyNativeSignatures();
verifyMarkdownSemantics();

console.log("Canonical engine port contracts verified.");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function verifyLegacyHarness() {
  const harness = readFileSync(
    join(repoRoot, "schema", "model", "pipeline", "harness.tsp"),
  );
  const actual = createHash("sha256").update(harness).digest("hex");
  assertEqual(
    actual,
    vector.legacyHarnessSha256,
    "pipeline/harness.tsp SHA-256",
  );
}

function verifyExportSurfaces() {
  const targetNames = surfaces.targets.map((target) => target.target);
  assertEqual(
    new Set(targetNames).size,
    targetNames.length,
    "Typra targets: duplicate names are not allowed",
  );
  assertEqual(
    JSON.stringify(targetNames.sort()),
    JSON.stringify(EXPECTED_TARGETS),
    "Typra targets",
  );

  for (const target of surfaces.targets) {
    assertUniqueNames(target.protocols, `${target.target}: protocols`);

    for (const nativeError of vector.nativeErrors) {
      assert(
        !JSON.stringify(target).includes(`"${nativeError}"`),
        `${target.target}: ${nativeError} must not appear in generated exports`,
      );
    }

    for (const [protocolName, expectedProtocol] of Object.entries(
      vector.protocols,
    )) {
      const protocol = target.protocols.find(
        (candidate) => candidate.name === protocolName,
      );
      assert(protocol, `${target.target}: missing ${protocolName} protocol`);
      assertUniqueNames(
        protocol.methods,
        `${target.target}: ${protocolName} methods`,
      );
      assertExactKeys(
        Object.fromEntries(
          protocol.methods.map((method) => [method.name, true]),
        ),
        Object.fromEntries(
          Object.keys(expectedProtocol.methods).map((methodName) => [
            methodName,
            true,
          ]),
        ),
        `${target.target}: ${protocolName} methods`,
      );

      for (const [methodName, expectedMethod] of Object.entries(
        expectedProtocol.methods,
      )) {
        const method = protocol.methods.find(
          (candidate) => candidate.name === methodName,
        );
        assert(
          method,
          `${target.target}: missing ${protocolName}.${methodName}`,
        );
        assertExactKeys(
          method,
          Object.fromEntries(
            ["name", ...Object.keys(expectedMethod)].map((key) => [key, true]),
          ),
          `${target.target}: ${protocolName}.${methodName} metadata`,
        );
        assertSubset(
          method,
          expectedMethod,
          `${target.target}: ${protocolName}.${methodName}`,
        );
        if (expectedMethod.params) {
          assertExactKeys(
            method.params,
            expectedMethod.params,
            `${target.target}: ${protocolName}.${methodName} params`,
          );
        }

        for (const syntheticName of [
          "cancellation",
          "cancellationToken",
          "ctx",
          "signal",
        ]) {
          assert(
            !Object.hasOwn(method.params, syntheticName),
            `${target.target}: ${protocolName}.${methodName} leaked runtime cancellation into schema params`,
          );
        }
      }
    }
  }
}

function verifyNoWireCancellation() {
  const schemaRoot = join(repoRoot, "vscode", "prompty", "schemas");
  const forbiddenFields = ["ctx", "runtimeCancellable", "atomic", "nonFatal"];

  for (const file of collectFiles(schemaRoot)) {
    const content = readFileSync(file, "utf8");
    for (const field of forbiddenFields) {
      const propertyPattern = new RegExp(
        `^\\s*(?:${field}|["']${field}["'])\\s*:\\s*`,
        "mi",
      );
      assert(
        !propertyPattern.test(content),
        `${file}: ${field} must not be emitted as a portable model field`,
      );
    }
    assert(
      !/^\s*(?:["']?[\w]*(?:cancel|abort|signal)[\w]*["']?)\s*:\s*/imu.test(
        content,
      ),
      `${file}: runtime cancellation must not be emitted as a portable model field`,
    );
    assert(
      !/(?:cancel|abort|signal)[^\\/]*\.ya?ml$/iu.test(file),
      `${file}: runtime cancellation types must not be portable models`,
    );
  }

  for (const protocol of [
    "EnginePermissionPort",
    "EngineToolPort",
    "EngineDurabilityPort",
    "EnginePostCommitPort",
    "Executor",
  ]) {
    const file = join(schemaRoot, `${protocol}.yaml`);
    const content = readFileSync(file, "utf8");
    assert(
      /^properties:\s*\{\}\s*$/mu.test(content),
      `${file}: protocol schemas must not expose properties`,
    );
    assert(
      !/^required:/mu.test(content),
      `${file}: protocol schemas must not expose required wire fields`,
    );
  }
}

function verifyNativeSignatures() {
  const root = {
    csharp: join(
      repoRoot,
      "runtime",
      "csharp",
      "Prompty.Core",
      "Model",
      "pipeline",
    ),
    go: join(repoRoot, "runtime", "go", "prompty", "model"),
    python: join(
      repoRoot,
      "runtime",
      "python",
      "prompty",
      "prompty",
      "model",
      "pipeline",
    ),
    rust: join(
      repoRoot,
      "runtime",
      "rust",
      "prompty",
      "src",
      "model",
      "pipeline",
    ),
    typescript: join(
      repoRoot,
      "runtime",
      "typescript",
      "packages",
      "core",
      "src",
      "model",
      "pipeline",
    ),
  };

  verifyCSharpSignatures(root.csharp);
  verifyGoSignatures(root.go);
  verifyTypeScriptSignatures(root.typescript);
  verifyRustSignatures(root.rust);
  verifyPythonSignatures(root.python);

  const durabilityFiles = [
    join(root.csharp, "EngineDurabilityPort.cs"),
    join(root.go, "engine_durability_port.go"),
    join(root.python, "_EngineDurabilityPort.py"),
    join(root.rust, "engine_durability_port.rs"),
    join(root.typescript, "engine-durability-port.ts"),
  ];
  for (const file of durabilityFiles) {
    const content = readFileSync(file, "utf8");
    for (const forbidden of [
      "CancellationToken",
      "context.Context",
      "AbortSignal",
    ]) {
      assert(
        !content.includes(forbidden),
        `${file}: durability protocol must remain non-cancellable`,
      );
    }
  }
}

function verifyCSharpSignatures(root) {
  expectMatches(
    join(root, "EnginePermissionPort.cs"),
    /^\s*Task<EnginePermissionDecision>\s+AuthorizeAsync\(\s*ModelToolRequest request,\s*CancellationToken cancellationToken = default\s*\);/mu,
  );
  expectMatches(
    join(root, "EngineToolPort.cs"),
    /^\s*Task<ModelToolResult>\s+ExecuteAsync\(\s*ModelToolRequest request,\s*CancellationToken cancellationToken = default\s*\);/mu,
  );
  expectAllMatches(join(root, "EngineDurabilityPort.cs"), [
    /^\s*Task\s+AppendAsync\(\s*EngineEvent @?event\s*\);/mu,
    /^\s*Task\s+AppendWithCheckpointAsync\(\s*List<EngineEvent> events,\s*EngineCheckpoint checkpoint\s*\);/mu,
  ]);
  expectMatches(
    join(root, "EnginePostCommitPort.cs"),
    /^\s*Task\s+AfterCommitAsync\(\s*string effectId,\s*TurnCommit commit,\s*CancellationToken cancellationToken = default\s*\);/mu,
  );
  expectAllMatches(join(root, "Executor.cs"), [
    /^\s*Task<object>\s+ExecuteAsync\(\s*Prompty agent,\s*List<Message> messages,\s*CancellationToken cancellationToken = default\s*\);/mu,
    /^\s*Task<object>\s+ExecuteStreamAsync\(\s*Prompty agent,\s*List<Message> messages,\s*CancellationToken cancellationToken = default\s*\)/mu,
    /^\s*List<Message>\s+FormatToolMessages\(\s*object rawResponse,\s*List<ToolCall> toolCalls,\s*List<string> toolResults,\s*string\? textContent\s*\);/mu,
  ]);
  assertDeclarationNames(
    join(root, "EnginePermissionPort.cs"),
    /^\s*[A-Za-z_][\w<>,? .]*\s+([A-Z]\w*)\(/gmu,
    ["AuthorizeAsync"],
  );
  assertDeclarationNames(
    join(root, "EngineToolPort.cs"),
    /^\s*[A-Za-z_][\w<>,? .]*\s+([A-Z]\w*)\(/gmu,
    ["ExecuteAsync"],
  );
  assertDeclarationNames(
    join(root, "EngineDurabilityPort.cs"),
    /^\s*[A-Za-z_][\w<>,? .]*\s+([A-Z]\w*)\(/gmu,
    ["AppendAsync", "AppendWithCheckpointAsync"],
  );
  assertDeclarationNames(
    join(root, "EnginePostCommitPort.cs"),
    /^\s*[A-Za-z_][\w<>,? .]*\s+([A-Z]\w*)\(/gmu,
    ["AfterCommitAsync"],
  );
  assertDeclarationNames(
    join(root, "Executor.cs"),
    /^\s*[A-Za-z_][\w<>,? .]*\s+([A-Z]\w*)\(/gmu,
    ["ExecuteAsync", "ExecuteStreamAsync", "FormatToolMessages"],
  );
}

function verifyGoSignatures(root) {
  expectMatches(
    join(root, "engine_permission_port.go"),
    /^\s*Authorize\(ctx context\.Context,\s*request ModelToolRequest\)\s*\(EnginePermissionDecision, error\)/mu,
  );
  expectMatches(
    join(root, "engine_tool_port.go"),
    /^\s*Execute\(ctx context\.Context,\s*request ModelToolRequest\)\s*\(ModelToolResult, error\)/mu,
  );
  expectAllMatches(join(root, "engine_durability_port.go"), [
    /^\s*Append\(event EngineEvent\)\s*error/mu,
    /^\s*AppendWithCheckpoint\(events \[\]EngineEvent,\s*checkpoint EngineCheckpoint\)\s*error/mu,
  ]);
  expectMatches(
    join(root, "engine_post_commit_port.go"),
    /^\s*AfterCommit\(ctx context\.Context,\s*effectId string,\s*commit TurnCommit\)\s*error/mu,
  );
  expectAllMatches(join(root, "executor.go"), [
    /^\s*Execute\(ctx context\.Context,\s*agent Prompty,\s*messages \[\]Message\)\s*\(interface\{\}, error\)/mu,
    /^\s*ExecuteStream\(ctx context\.Context,\s*agent Prompty,\s*messages \[\]Message\)\s*\(interface\{\}, error\)/mu,
    /^\s*FormatToolMessages\(rawResponse interface\{\},\s*toolCalls \[\]ToolCall,\s*toolResults \[\]string,\s*textContent \*string\)\s*\(\[\]Message, error\)/mu,
  ]);
  for (const [file, expected] of [
    ["engine_permission_port.go", ["Authorize"]],
    ["engine_tool_port.go", ["Execute"]],
    ["engine_durability_port.go", ["Append", "AppendWithCheckpoint"]],
    ["engine_post_commit_port.go", ["AfterCommit"]],
    ["executor.go", ["Execute", "ExecuteStream", "FormatToolMessages"]],
  ]) {
    assertDeclarationNames(join(root, file), /^\s*([A-Z]\w*)\(/gmu, expected);
  }
}

function verifyTypeScriptSignatures(root) {
  expectMatches(
    join(root, "engine-permission-port.ts"),
    /^\s{2}authorize\(\s*request: ModelToolRequest,\s*signal\?: AbortSignal,?\s*\): Promise<EnginePermissionDecision>;/mu,
  );
  expectMatches(
    join(root, "engine-tool-port.ts"),
    /^\s{2}execute\(\s*request: ModelToolRequest,\s*signal\?: AbortSignal,?\s*\): Promise<ModelToolResult>;/mu,
  );
  expectAllMatches(join(root, "engine-durability-port.ts"), [
    /^\s{2}append\(\s*event: EngineEvent,?\s*\): Promise<void>;/mu,
    /^\s{2}appendWithCheckpoint\(\s*events: EngineEvent\[\],\s*checkpoint: EngineCheckpoint,?\s*\): Promise<void>;/mu,
  ]);
  expectMatches(
    join(root, "engine-post-commit-port.ts"),
    /^\s{2}afterCommit\(\s*effectId: string,\s*commit: TurnCommit,\s*signal\?: AbortSignal,?\s*\): Promise<void>;/mu,
  );
  expectAllMatches(join(root, "executor.ts"), [
    /^\s{2}execute\(\s*agent: Prompty,\s*messages: Message\[\],\s*signal\?: AbortSignal,?\s*\): Promise<unknown>;/mu,
    /^\s{2}executeStream\?\(\s*agent: Prompty,\s*messages: Message\[\],\s*signal\?: AbortSignal,?\s*\): Promise<unknown>;/mu,
    /^\s{2}formatToolMessages\(\s*rawResponse: unknown,\s*toolCalls: ToolCall\[\],\s*toolResults: string\[\],\s*textContent: string \| null,?\s*\): Message\[\];/mu,
  ]);
  for (const [file, expected] of [
    ["engine-permission-port.ts", ["authorize"]],
    ["engine-tool-port.ts", ["execute"]],
    ["engine-durability-port.ts", ["append", "appendWithCheckpoint"]],
    ["engine-post-commit-port.ts", ["afterCommit"]],
    ["executor.ts", ["execute", "executeStream", "formatToolMessages"]],
  ]) {
    assertDeclarationNames(
      join(root, file),
      /^\s{2}([a-z]\w*)\??\(/gmu,
      expected,
    );
  }
}

function verifyRustSignatures(root) {
  expectMatches(
    join(root, "engine_permission_port.rs"),
    /^\s{4}async fn authorize\(\s*&self,\s*request: &ModelToolRequest,\s*cancellation: &CancellationToken,?\s*\)\s*-> Result<EnginePermissionDecision,\s*Box<dyn std::error::Error \+ Send \+ Sync>>;/mu,
  );
  expectMatches(
    join(root, "engine_tool_port.rs"),
    /^\s{4}async fn execute\(\s*&self,\s*request: &ModelToolRequest,\s*cancellation: &CancellationToken,?\s*\)\s*-> Result<ModelToolResult,\s*Box<dyn std::error::Error \+ Send \+ Sync>>;/mu,
  );
  expectAllMatches(join(root, "engine_durability_port.rs"), [
    /^\s{4}async fn append\(\s*&self,\s*event: &EngineEvent,?\s*\)\s*-> Result<\(\),\s*Box<dyn std::error::Error \+ Send \+ Sync>>;/mu,
    /^\s{4}async fn append_with_checkpoint\(\s*&self,\s*events: &Vec<EngineEvent>,\s*checkpoint: &EngineCheckpoint,?\s*\)\s*-> Result<\(\),\s*Box<dyn std::error::Error \+ Send \+ Sync>>;/mu,
  ]);
  expectMatches(
    join(root, "engine_post_commit_port.rs"),
    /^\s{4}async fn after_commit\(\s*&self,\s*effect_id: &String,\s*commit: &TurnCommit,\s*cancellation: &CancellationToken,?\s*\)\s*-> Result<\(\),\s*Box<dyn std::error::Error \+ Send \+ Sync>>;/mu,
  );
  expectAllMatches(join(root, "executor.rs"), [
    /^\s{4}async fn execute\(\s*&self,\s*agent: &Prompty,\s*messages: &Vec<Message>,\s*cancellation: &CancellationToken,?\s*\)\s*-> Result<serde_json::Value,\s*Box<dyn std::error::Error \+ Send \+ Sync>>;/mu,
    /^\s{4}async fn execute_stream\(\s*&self,\s*agent: &Prompty,\s*messages: &Vec<Message>,\s*cancellation: &CancellationToken,?\s*\)\s*-> Result<serde_json::Value,\s*Box<dyn std::error::Error \+ Send \+ Sync>>/mu,
    /^\s{4}fn format_tool_messages\(\s*&self,\s*raw_response: &serde_json::Value,\s*tool_calls: &Vec<ToolCall>,\s*tool_results: &Vec<String>,\s*text_content: &Option<String>,?\s*\)\s*-> Vec<Message>;/mu,
  ]);
  for (const [file, expected] of [
    ["engine_permission_port.rs", ["authorize"]],
    ["engine_tool_port.rs", ["execute"]],
    ["engine_durability_port.rs", ["append", "append_with_checkpoint"]],
    ["engine_post_commit_port.rs", ["after_commit"]],
    ["executor.rs", ["execute", "execute_stream", "format_tool_messages"]],
  ]) {
    assertDeclarationNames(
      join(root, file),
      /^\s{4}(?:async\s+)?fn\s+([a-z]\w*)\(/gmu,
      expected,
    );
  }
}

function verifyPythonSignatures(root) {
  expectAllMatches(join(root, "_EnginePermissionPort.py"), [
    /^\s{4}def authorize\(\s*self,\s*request: ModelToolRequest,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> EnginePermissionDecision:/mu,
    /^\s{4}async def authorize_async\(\s*self,\s*request: ModelToolRequest,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> EnginePermissionDecision:/mu,
  ]);
  expectAllMatches(join(root, "_EngineToolPort.py"), [
    /^\s{4}def execute\(\s*self,\s*request: ModelToolRequest,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> ModelToolResult:/mu,
    /^\s{4}async def execute_async\(\s*self,\s*request: ModelToolRequest,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> ModelToolResult:/mu,
  ]);
  expectAllMatches(join(root, "_EngineDurabilityPort.py"), [
    /^\s{4}def append\(\s*self,\s*event: EngineEvent\s*\)\s*-> None:/mu,
    /^\s{4}async def append_async\(\s*self,\s*event: EngineEvent\s*\)\s*-> None:/mu,
    /^\s{4}def append_with_checkpoint\(\s*self,\s*events: list\[EngineEvent\],\s*checkpoint: EngineCheckpoint\s*\)\s*-> None:/mu,
    /^\s{4}async def append_with_checkpoint_async\(\s*self,\s*events: list\[EngineEvent\],\s*checkpoint: EngineCheckpoint\s*\)\s*-> None:/mu,
  ]);
  expectAllMatches(join(root, "_EnginePostCommitPort.py"), [
    /^\s{4}def after_commit\(\s*self,\s*effect_id: str,\s*commit: TurnCommit,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> None:/mu,
    /^\s{4}async def after_commit_async\(\s*self,\s*effect_id: str,\s*commit: TurnCommit,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> None:/mu,
  ]);
  expectAllMatches(join(root, "_Executor.py"), [
    /^\s{4}def execute\(\s*self,\s*agent: Prompty,\s*messages: list\[Message\],\s*cancellation: CancellationToken \| None = None\s*\)\s*-> Any:/mu,
    /^\s{4}async def execute_async\(\s*self,\s*agent: Prompty,\s*messages: list\[Message\],\s*cancellation: CancellationToken \| None = None\s*\)\s*-> Any:/mu,
    /^\s{4}def execute_stream\(\s*self,\s*agent: Prompty,\s*messages: list\[Message\],\s*cancellation: CancellationToken \| None = None\s*\)\s*-> Any:/mu,
    /^\s{4}async def execute_stream_async\(\s*self,\s*agent: Prompty,\s*messages: list\[Message\],\s*cancellation: CancellationToken \| None = None\s*\)\s*-> Any:/mu,
    /^\s{4}def format_tool_messages\(\s*self,\s*raw_response: Any,\s*tool_calls: list\[ToolCall\],\s*tool_results: list\[str\],\s*text_content: str \| None\s*\)\s*-> list\[Message\]:/mu,
  ]);
  for (const [file, expected] of [
    ["_EnginePermissionPort.py", ["authorize", "authorize_async"]],
    ["_EngineToolPort.py", ["execute", "execute_async"]],
    [
      "_EngineDurabilityPort.py",
      [
        "append",
        "append_async",
        "append_with_checkpoint",
        "append_with_checkpoint_async",
      ],
    ],
    ["_EnginePostCommitPort.py", ["after_commit", "after_commit_async"]],
    [
      "_Executor.py",
      [
        "execute",
        "execute_async",
        "execute_stream",
        "execute_stream_async",
        "format_tool_messages",
      ],
    ],
  ]) {
    assertDeclarationNames(
      join(root, file),
      /^\s{4}(?:async\s+)?def\s+([a-z]\w*)\(/gmu,
      expected,
    );
  }
}

function verifyMarkdownSemantics() {
  const root = join(repoRoot, "web", "src", "content", "docs", "reference");
  expectMarkdownMethod(
    join(root, "EnginePermissionPort.md"),
    "authorize",
    "authorize(request: ModelToolRequest) -> EnginePermissionDecision",
    ["async-capable", "runtime-cancellable"],
    ["atomic", "non-fatal", "sync"],
  );
  expectMarkdownMethod(
    join(root, "EngineToolPort.md"),
    "execute",
    "execute(request: ModelToolRequest) -> ModelToolResult",
    ["async-capable", "runtime-cancellable"],
    ["atomic", "non-fatal", "sync"],
  );
  expectMarkdownMethod(
    join(root, "EngineDurabilityPort.md"),
    "append",
    "append(event: EngineEvent) -> void",
    ["async-capable"],
    ["runtime-cancellable", "atomic", "non-fatal", "sync"],
  );
  expectMarkdownMethod(
    join(root, "EngineDurabilityPort.md"),
    "appendWithCheckpoint",
    "appendWithCheckpoint(events: EngineEvent[], checkpoint: EngineCheckpoint) -> void",
    ["async-capable", "atomic"],
    ["runtime-cancellable", "non-fatal", "sync"],
  );
  expectMarkdownMethod(
    join(root, "EnginePostCommitPort.md"),
    "afterCommit",
    "afterCommit(effectId: string, commit: TurnCommit) -> void",
    ["async-capable", "runtime-cancellable", "non-fatal"],
    ["atomic", "sync"],
  );
  expectMarkdownMethod(
    join(root, "Executor.md"),
    "execute",
    "execute(agent: Prompty, messages: Message[]) -> unknown",
    ["async-capable", "runtime-cancellable"],
    ["atomic", "non-fatal", "sync"],
  );
  expectMarkdownMethod(
    join(root, "Executor.md"),
    "executeStream",
    "executeStream(agent: Prompty, messages: Message[]) -> unknown",
    ["async-capable", "runtime-cancellable"],
    ["atomic", "non-fatal", "sync"],
  );
  expectMarkdownMethod(
    join(root, "Executor.md"),
    "formatToolMessages",
    "formatToolMessages(rawResponse: unknown, toolCalls: ToolCall[], toolResults: string[], textContent: string?) -> Message[]",
    ["sync"],
    ["async-capable", "runtime-cancellable", "atomic", "non-fatal"],
  );
}

function expectMarkdownMethod(
  path,
  methodName,
  signature,
  requiredEffects,
  forbiddenEffects,
) {
  const content = readFileSync(path, "utf8");
  const row = content
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`| \`${methodName}\` |`));
  assert(row, `${path}: missing ${methodName} helper-method row`);

  const columns = row.split("|");
  assertEqual(
    columns[2].trim(),
    `\`${signature}\``,
    `${path}: ${methodName} signature`,
  );
  const runtimeShape = columns[3].trim().toLowerCase();
  for (const effect of requiredEffects) {
    assert(
      hasRuntimeEffect(runtimeShape, effect),
      `${path}: ${methodName} runtime shape must include ${effect}`,
    );
  }
  for (const effect of forbiddenEffects) {
    assert(
      !hasRuntimeEffect(runtimeShape, effect),
      `${path}: ${methodName} runtime shape must not include ${effect}`,
    );
  }
}

function hasRuntimeEffect(runtimeShape, effect) {
  const escaped = effect.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const normalized = runtimeShape.replace(/[_()]/gu, " ");
  return new RegExp(`(?:^|[,\\s])${escaped}(?=$|[,\\s])`, "u").test(normalized);
}

function expectMatches(path, pattern) {
  const content = readFileSync(path, "utf8");
  assert(
    pattern.test(content),
    `${path}: generated signature did not match ${pattern}`,
  );
}

function expectAllMatches(path, patterns) {
  for (const pattern of patterns) {
    expectMatches(path, pattern);
  }
}

function assertDeclarationNames(path, pattern, expected) {
  const content = readFileSync(path, "utf8");
  const actual = [...content.matchAll(pattern)].map((match) => match[1]).sort();
  assertEqual(
    JSON.stringify(actual),
    JSON.stringify([...expected].sort()),
    `${path}: native method declarations`,
  );
}

function collectFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function assertSubset(actual, expected, label) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (
      expectedValue !== null &&
      typeof expectedValue === "object" &&
      !Array.isArray(expectedValue)
    ) {
      assert(
        actualValue !== null && typeof actualValue === "object",
        `${label}.${key}: expected an object`,
      );
      assertSubset(actualValue, expectedValue, `${label}.${key}`);
    } else {
      assertEqual(actualValue, expectedValue, `${label}.${key}`);
    }
  }
}

function assertExactKeys(actual, expected, label) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  assertEqual(
    JSON.stringify(actualKeys),
    JSON.stringify(expectedKeys),
    `${label} keys`,
  );
}

function assertUniqueNames(items, label) {
  const names = items.map((item) => item.name);
  assertEqual(
    new Set(names).size,
    names.length,
    `${label}: duplicate names are not allowed`,
  );
}

function assertEqual(actual, expected, label) {
  assert(
    actual === expected,
    `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
