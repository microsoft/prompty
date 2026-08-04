import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
verifyNativeSignatures();

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
  for (const target of surfaces.targets) {
    for (const [protocolName, expectedProtocol] of Object.entries(
      vector.protocols,
    )) {
      const protocol = target.protocols.find(
        (candidate) => candidate.name === protocolName,
      );
      assert(protocol, `${target.target}: missing ${protocolName} protocol`);
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

  expectMatches(
    join(root.csharp, "EnginePermissionPort.cs"),
    /Task<EnginePermissionDecision>\s+AuthorizeAsync\(ModelToolRequest request,\s*CancellationToken cancellationToken = default\);/u,
  );
  expectMatches(
    join(root.go, "engine_permission_port.go"),
    /Authorize\(ctx context\.Context,\s*request ModelToolRequest\)\s*\(EnginePermissionDecision, error\)/u,
  );
  expectMatches(
    join(root.typescript, "engine-permission-port.ts"),
    /authorize\(request: ModelToolRequest,\s*signal\?: AbortSignal\): Promise<EnginePermissionDecision>;/u,
  );
  expectMatches(
    join(root.rust, "engine_permission_port.rs"),
    /async fn authorize\(\s*&self,\s*request: &ModelToolRequest,\s*cancellation: &CancellationToken,\s*\)\s*-> Result<EnginePermissionDecision,/u,
  );
  expectMatches(
    join(root.python, "_EnginePermissionPort.py"),
    /async def authorize_async\(\s*self,\s*request: ModelToolRequest,\s*cancellation: CancellationToken \| None = None\s*\)\s*-> EnginePermissionDecision:/u,
  );

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

  const executorFiles = [
    join(root.csharp, "Executor.cs"),
    join(root.go, "executor.go"),
    join(root.python, "_Executor.py"),
    join(root.rust, "executor.rs"),
    join(root.typescript, "executor.ts"),
  ];
  for (const file of executorFiles) {
    const content = readFileSync(file, "utf8");
    assert(
      content.includes("formatToolMessages") ||
        content.includes("format_tool_messages") ||
        content.includes("FormatToolMessages"),
      `${file}: missing synchronous formatToolMessages`,
    );
  }
}

function expectMatches(path, pattern) {
  const content = readFileSync(path, "utf8");
  assert(
    pattern.test(content),
    `${path}: generated signature did not match ${pattern}`,
  );
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
