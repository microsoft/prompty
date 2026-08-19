import "@typra/emitter";
import "@typespec/json-schema";
import "./contracts/core/core.tsp";
import "./contracts/models/model.tsp";
import "./contracts/core/properties.tsp";
import "./contracts/tooling/tool.tsp";
import "./contracts/tooling/mcp.tsp";
import "./contracts/tooling/openapi.tsp";
import "./contracts/tooling/prompty.tsp";
import "./contracts/tooling/dispatch.tsp";
import "./contracts/templates/template.tsp";

using TypeSpec.JsonSchema;

using Prompty.Conformance.Samples;
using Prompty.Contracts.Core;
using Prompty.Contracts.Models;
using Prompty.Contracts.Templates;
using Prompty.Contracts.Tooling;
namespace Prompty;

/**
 * An Agent is the root model produced from a .prompty markdown file for LLM
 * prompts. The frontmatter defines structured metadata including model
 * configuration, input/output schemas, tools, and template settings. The
 * markdown body becomes the instructions.
 *
 * This is the single root type for the Prompty schema — there is no abstract base
 * class or kind discriminator. A .prompty file always produces an Agent instance.
 *
 * Runtime loaders may resolve frontmatter references such as `${env:VAR}` and
 * `${file:relative/path}`. File references must be treated as a host-controlled
 * capability: by default they are scoped to the containing .prompty file's
 * directory tree after canonicalization, and any additional allowed roots must
 * be supplied by the host application's load options rather than frontmatter.
 */
@extension("additionalProperties", false)
model Agent {
  // Identity & metadata
  @doc("Human-readable name of the prompt")
  @sample(PromptyNameSample)
  name: string = "";

  @doc("Display name for UI purposes")
  @sample(PromptyDisplayNameSample)
  displayName?: string = "";

  @doc("Description of the prompt's purpose")
  @sample(PromptyDescriptionSample)
  description?: string = "";

  @doc("Additional metadata including authors, tags, and other arbitrary properties. Values may be explicit null.")
  @sample(PromptyMetadataSample)
  metadata?: Record<unknown>;

  // Inputs and Outputs
  @doc("Input parameters that participate in template rendering")
  @sample(PromptyInputsSample)
  @sample(PromptyInputsSample2)
  inputs?: Properties;

  @doc("Expected output format and structure")
  @sample(PromptyOutputsSample)
  @sample(PromptyOutputsSample2)
  outputs?: Properties;

  // Model execution
  @doc("AI model configuration")
  @sample(PromptyIdSample)
  `model`?: Model | string;

  // Tools
  @doc("Tools available for extended functionality")
  @sample(PromptyToolsSample)
  @sample(PromptyToolsSample2)
  tools?: Tools;

  // Template
  @doc("Template configuration for prompt rendering")
  @sample(PromptyTemplateSample)
  template?: Template;

  // Instructions
  @doc("Clear directions on what the prompt should do. In .prompty files, this comes from the markdown body.")
  @sample(PromptyInstructionsSample)
  instructions?: string = "";
}
