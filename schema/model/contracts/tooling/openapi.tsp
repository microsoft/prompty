import "../core/core.tsp";
import "./tool.tsp";
import "../connectivity/connection.tsp";

using Prompty.Conformance.Samples;
using Prompty.Contracts.Connectivity;
namespace Prompty.Contracts.Tooling;

/*
 * The OpenAPI tool.
 */
model OpenApiTool extends Tool {
  @doc("The kind identifier for OpenAPI tools")
  @sample(OpenApiToolKindSample)
  kind: "openapi";

  @doc("The connection configuration for the OpenAPI tool")
  @sample(OpenApiToolConnectionSample)
  connection: Connection;

  @doc("The full OpenAPI specification")
  @sample(OpenApiToolSpecificationSample)
  specification: string;
}
