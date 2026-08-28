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
 * Open discriminator union naming the template dialects Prompty ships renderers
 * for, plus a bare `string` escape hatch for downstream renderers. The bare
 * `string` member keeps the set OPEN; unknown dialects route to `CustomFormat`.
 */
union FormatKind {
  jinja2: "jinja2",
  mustache: "mustache",
  string,
}

/**
 * Template format definition. `kind` is the `@dispatch` discriminator for the
 * Renderer seam, reached from a seam param as `agent.template.format.kind`.
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
  kind: FormatKind = "*";

  @doc("Whether the template can emit structural text for parsing output")
  @sample(FormatConfigStrictSample)
  strict?: boolean = false;

  @doc("Options for the template engine")
  @sample(FormatConfigOptionsSample)
  options?: Record<unknown>;
}

/**
 * Jinja2 template dialect. Pin-only subtype.
 */
model Jinja2Format extends FormatConfig {
  @doc("The Jinja2 format discriminator")
  kind: "jinja2";
}

/**
 * Mustache template dialect. Pin-only subtype.
 */
model MustacheFormat extends FormatConfig {
  @doc("The Mustache format discriminator")
  kind: "mustache";
}

/**
 * Wildcard catch-all format for downstream/unregistered template dialects. The
 * `"*"` discriminator lowers to the Renderer dispatch decl's `defaultVariant`.
 */
model CustomFormat extends FormatConfig {
  @doc("The wildcard format discriminator for any dialect not explicitly modeled")
  kind: "*";
}

/**
 * Open discriminator union naming the parser kinds Prompty ships parsers for,
 * plus a bare `string` escape hatch for downstream parsers.
 */
union ParserKind {
  prompty: "prompty",
  string,
}

/**
 * Template parser definition. `kind` is the `@dispatch` discriminator for the
 * Parser seam, reached from a seam param as `agent.template.parser.kind`.
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
  kind: ParserKind = "*";

  @doc("Options for the parser")
  @sample(ParserConfigOptionsSample)
  options?: Record<unknown>;
}

/**
 * The default Prompty chat parser. Pin-only subtype.
 */
model PromptyParser extends ParserConfig {
  @doc("The Prompty parser discriminator")
  kind: "prompty";
}

/**
 * Wildcard catch-all parser for downstream/unregistered parser kinds. The `"*"`
 * discriminator lowers to the Parser dispatch decl's `defaultVariant`.
 */
model CustomParser extends ParserConfig {
  @doc("The wildcard parser discriminator for any kind not explicitly modeled")
  kind: "*";
}
