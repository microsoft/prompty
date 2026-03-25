import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace AgentSchema;

/*
 * The OpenAPI tool.
 */
model OpenApiTool extends Tool {
  @doc("The kind identifier for OpenAPI tools")
  @sample(#{ kind: "openapi" })
  kind: "openapi";

  @doc("The connection configuration for the OpenAPI tool")
  @sample(#{ connection: #{ kind: "reference" } })
  connection: Connection;

  @doc("The full OpenAPI specification")
  @sample(#{ specification: "full_sepcification_here" })
  specification: string;
}
