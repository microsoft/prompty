import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace Prompty.Core {

  model OpenApiTool extends Tool {
    @doc("The kind identifier for OpenAPI tools")
    @sample(#{ kind: "openapi" })
    kind: "openapi";

    @doc("The connection configuration for the OpenAPI tool")
    @sample(#{ connection: #{ kind: "provider-connection" } })
    connection: Connection;

    @doc("The URL or relative path to the OpenAPI specification document (JSON or YAML format)")
    @sample(#{ specification: "https://api.example.com/openapi.json" })
    specification: string;
  }
}