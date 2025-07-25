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
   * Example:
   * ```yaml
   * template:
   *   format: jinja2
   *   parser: prompty
   * ```
   */
  model Template {
    @doc("Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)")
    format: string;

    @doc("Parser used to process the rendered template into API-compatible format")
    parser: string;

    @doc("Whether the template can emit structural text for parsing output")
    strict?: boolean = false;

    @doc("Additional options for the template engine")
    options?: Options = #{};
  }
}
