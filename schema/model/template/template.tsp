import "@typra/emitter";
import "../core/core.tsp";

using Prompty.Conformance.Samples;
using Prompty.Operations.Pipeline;
namespace Prompty.Contracts.Templates;

/**
 * Template model for defining prompt templates.
 *
 * This model specifies the rendering engine used for slot filling prompts,
 * the parser used to process the rendered template into API-compatible format,
 * and additional options for the template engine.
 *
 * It allows for the creation of reusable templates that can be filled with dynamic data
 * and processed to generate prompts for AI models.
 *
 */
model Template {
  @doc("Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)")
  @sample(forFormatSample)
  format: FormatConfig | string;

  @doc("Parser used to process the rendered template into API-compatible format")
  @sample(forParserSample)
  parser: ParserConfig | string;
}

/**
 * Template format definition
 */
@discriminator("kind")
@coerce(
  string,
  #{ kind: "{value}" },
  "format",
  "Simple construction with just a \"kind\" string"
)
model FormatConfig {
  @doc("Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)")
  @sample(FormatConfigKindSample)
  kind: string = "*";

  @doc("Whether the template can emit structural text for parsing output")
  @sample(FormatConfigStrictSample)
  strict?: boolean = false;

  @doc("Options for the template engine")
  @sample(FormatConfigOptionsSample)
  options?: Record<unknown>;
}

/**
 * Template parser definition
 */
@discriminator("kind")
@coerce(
  string,
  #{ kind: "{value}" },
  "parser",
  "Simple construction with just a \"kind\" string"
)
model ParserConfig {
  @doc("Parser used to process the rendered template into API-compatible format")
  @sample(ParserConfigKindSample)
  kind: string = "*";

  @doc("Options for the parser")
  @sample(ParserConfigOptionsSample)
  options?: Record<unknown>;
}
