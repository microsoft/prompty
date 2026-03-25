#!/usr/bin/env node

import { generate, TargetLanguage } from "./generate.js";
import { parseArgs } from "util";

const HELP = `
agentschema-generate - Generate AgentSchema runtime libraries

Usage:
  npx agentschema-generate [options]

Options:
  -o, --output <dir>       Output directory (required)
  -t, --targets <list>     Comma-separated list of targets (default: python,csharp,typescript,go)
  -r, --root-object <name> Root object to generate from (default: AgentSchema.AgentManifest)
  --omit <list>            Comma-separated list of models to omit
  -n, --namespace <name>   Root namespace for generated code (default: AgentSchema)
  --no-tests               Skip generating test files
  --no-format              Skip running formatters
  -h, --help               Show this help message

Examples:
  # Generate all runtimes to ./generated
  npx agentschema-generate -o ./generated

  # Generate only Python and C# 
  npx agentschema-generate -o ./lib -t python,csharp

  # Generate AgentDefinition instead of AgentManifest
  npx agentschema-generate -o ./lib -r AgentSchema.AgentDefinition

  # Omit specific models
  npx agentschema-generate -o ./lib --omit AgentManifest,ContainerAgent

Targets:
  python       Python dataclasses with YAML/JSON serialization
  csharp       C# classes with System.Text.Json serialization
  typescript   TypeScript interfaces with js-yaml serialization
  go           Go structs with encoding/json and gopkg.in/yaml.v3
  markdown     Markdown documentation
`;

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      targets: { type: "string", short: "t" },
      "root-object": { type: "string", short: "r" },
      omit: { type: "string" },
      namespace: { type: "string", short: "n" },
      "no-tests": { type: "boolean", default: false },
      "no-format": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  // Output is required
  const output = values.output || positionals[0];
  if (!output) {
    console.error("Error: Output directory is required. Use -o <dir> or --output <dir>\n");
    console.log(HELP);
    process.exit(1);
  }

  // Parse targets
  const targetsString = values.targets || "python,csharp,typescript,go";
  const targets = targetsString.split(",").map(t => t.trim().toLowerCase()) as TargetLanguage[];

  // Validate targets
  const validTargets = ["python", "csharp", "typescript", "go", "markdown"];
  for (const target of targets) {
    if (!validTargets.includes(target)) {
      console.error(`Error: Invalid target "${target}". Valid targets: ${validTargets.join(", ")}`);
      process.exit(1);
    }
  }

  // Parse omit list
  const omit = values.omit ? values.omit.split(",").map(m => m.trim()) : [];

  console.log(`\n🚀 AgentSchema Generator\n`);
  console.log(`  Output:      ${output}`);
  console.log(`  Targets:     ${targets.join(", ")}`);
  console.log(`  Root Object: ${values["root-object"] || "AgentSchema.AgentManifest"}`);
  if (omit.length > 0) {
    console.log(`  Omitting:    ${omit.join(", ")}`);
  }
  console.log();

  const result = await generate({
    output,
    targets,
    rootObject: values["root-object"] || "AgentSchema.AgentManifest",
    omit,
    namespace: values.namespace,
    generateTests: !values["no-tests"],
    format: !values["no-format"],
  });

  if (result.success) {
    console.log(`✅ Successfully generated code for: ${result.targets.join(", ")}`);
    console.log(`   Output directory: ${result.outputDir}\n`);
    process.exit(0);
  } else {
    console.error(`❌ Generation failed:`);
    result.errors?.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }
}

main().catch(error => {
  console.error("Fatal error:", error);
  process.exit(1);
});
