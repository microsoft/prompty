import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import * as YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Target language for code generation.
 */
export type TargetLanguage = "python" | "csharp" | "typescript" | "go" | "rust" | "markdown";

/**
 * Options for a specific target language.
 */
export interface TargetOptions {
  /** Output directory for generated code */
  outputDir: string;
  /** Output directory for generated tests (optional) */
  testDir?: string;
  /** Override the namespace for generated code */
  namespace?: string;
  /** Run formatters on emitted files (default: true) */
  format?: boolean;
}

/**
 * Options for the generate function.
 */
export interface GenerateOptions {
  /** 
   * Output directory for generated code.
   * Each target will create a subdirectory (e.g., output/python, output/csharp)
   */
  output: string;

  /**
   * Target languages to generate code for.
   * @default ["python", "csharp", "typescript", "go"]
   */
  targets?: TargetLanguage[] | Record<TargetLanguage, TargetOptions>;

  /**
   * Root object to start generation from.
   * @default "AgentSchema.AgentManifest"
   */
  rootObject?: string;

  /**
   * List of model names to omit from generation.
   * Can be simple names (e.g., "AgentManifest") or fully qualified (e.g., "AgentSchema.AgentManifest")
   */
  omit?: string[];

  /**
   * Root namespace for the generated code.
   * @default "AgentSchema"
   */
  namespace?: string;

  /**
   * Alias for the root object in generated code.
   */
  rootAlias?: string;

  /**
   * Generate test files.
   * @default true
   */
  generateTests?: boolean;

  /**
   * Run formatters on emitted files.
   * @default true
   */
  format?: boolean;
}

/**
 * Result of the generate function.
 */
export interface GenerateResult {
  success: boolean;
  outputDir: string;
  targets: string[];
  errors?: string[];
}

/**
 * Generate AgentSchema runtime libraries.
 * 
 * @example
 * ```typescript
 * import { generate } from 'agentschema-emitter/generate';
 * 
 * await generate({
 *   output: './generated',
 *   targets: ['python', 'csharp'],
 *   rootObject: 'AgentSchema.AgentDefinition',
 *   omit: ['AgentManifest']
 * });
 * ```
 */
export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const {
    output,
    targets = ["python", "csharp", "typescript", "go"],
    rootObject = "AgentSchema.AgentManifest",
    omit = [],
    namespace = "AgentSchema",
    rootAlias,
    generateTests = true,
    format = true,
  } = options;

  // Resolve the model path (inside the package)
  // __dirname is dist/src at runtime, so we need to go up two levels to package root
  const packageRoot = path.resolve(__dirname, "../..");
  const modelPath = path.resolve(packageRoot, "lib/model/main.tsp");

  // Ensure output directory exists
  const outputDir = path.resolve(output);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Build emit targets configuration
  const emitTargets = buildEmitTargets(targets, outputDir, generateTests, format);

  // Create temporary tspconfig.yaml
  const tspConfig = {
    emit: ["agentschema-emitter"],
    options: {
      "agentschema-emitter": {
        "emitter-output-dir": outputDir,
        "root-object": rootObject,
        "root-namespace": namespace,
        ...(rootAlias && { "root-alias": rootAlias }),
        ...(omit.length > 0 && { "omit-models": omit }),
        "emit-targets": emitTargets,
      },
    },
  };

  // Write temporary config file
  const tempConfigPath = path.join(outputDir, ".tspconfig.temp.yaml");
  writeFileSync(tempConfigPath, YAML.stringify(tspConfig));

  try {
    // Run tsp compile
    execSync(`tsp compile "${modelPath}" --config "${tempConfigPath}"`, {
      stdio: "inherit",
      cwd: outputDir,
    });

    return {
      success: true,
      outputDir,
      targets: Array.isArray(targets) ? targets : Object.keys(targets),
    };
  } catch (error) {
    return {
      success: false,
      outputDir,
      targets: Array.isArray(targets) ? targets : Object.keys(targets),
      errors: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    // Clean up temp config
    try {
      unlinkSync(tempConfigPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function buildEmitTargets(
  targets: TargetLanguage[] | Record<TargetLanguage, TargetOptions>,
  baseOutput: string,
  generateTests: boolean,
  format: boolean
): Array<{
  type: string;
  "output-dir": string;
  "test-dir"?: string;
  format?: boolean;
  namespace?: string;
}> {
  if (Array.isArray(targets)) {
    // Simple array of target names - use default directories
    return targets.map(target => ({
      type: target,
      "output-dir": path.join(baseOutput, target),
      "test-dir": generateTests ? path.join(baseOutput, target, "tests") : undefined,
      format,
    }));
  } else {
    // Object with per-target configuration
    return Object.entries(targets).map(([target, opts]) => ({
      type: target,
      "output-dir": opts.outputDir,
      "test-dir": opts.testDir,
      format: opts.format ?? format,
      namespace: opts.namespace,
    }));
  }
}
