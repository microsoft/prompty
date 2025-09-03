import "../core.tsp";

namespace Prompty.Core {
  @doc("""
      Authentication types. Allowed types are:
      - Anonymous (no authentication required)
      - Connection (requires connection_id to endpoint, as setup in AI Foundry)
      - Managed_Identity (requires audience for identity based auth)
    """)
  union AuthType {
    anonymous: "anonymous",
    connection: "connection",
    managedIdentity: "managed_identity",
    string,
  }

  /**
   * Authentication configuration for the MCP tool
   */
  model Authentication {
    @doc("The type of authentication to use")
    type: AuthType;

    @doc("The credentials to use for authentication")
    credentials: Options
  }
}
