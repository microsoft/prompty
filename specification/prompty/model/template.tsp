import "@prompty/emitter";
import "./core.tsp";

namespace Prompty.Core {
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
    @sample(#{ format: #{ kind: "mustache" } })
    format: Format | string;

    @doc("Parser used to process the rendered template into API-compatible format")
    @sample(#{ parser: #{ kind: "mustache" } })
    parser: Parser | string;
  }

  /**
   * Template format definition
   */
  @discriminator("kind")
  @shorthand(
    string,
    #{ kind: "{value}" },
    "format",
    "Simple construction with just a \"kind\" string"
  )
  model Format {
    @doc("Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)")
    @sample(#{ kind: "mustache" })
    kind: string = "*";

    @doc("Whether the template can emit structural text for parsing output")
    @sample(#{ strict: true })
    strict?: boolean = false;

    @doc("Options for the template engine")
    @sample(#{ options: #{ key: "value" } })
    options?: Record<unknown> = #{};
  }

  /**
   * Template parser definition
   */
  @discriminator("kind")
  @shorthand(
    string,
    #{ kind: "{value}" },
    "parser",
    "Simple construction with just a \"kind\" string"
  )
  model Parser {
    @doc("Parser used to process the rendered template into API-compatible format")
    @sample(#{ kind: "prompty" })
    kind: string = "*";

    @doc("Options for the parser")
    @sample(#{ options: #{ key: "value" } })
    options?: Record<unknown> = #{};
  }
}
