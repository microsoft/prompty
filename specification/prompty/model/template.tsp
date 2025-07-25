import "./core.tsp";

namespace Prompty.Core {
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
