import "@prompty/emitter";

namespace Prompty.Core {
  alias ConnectionType = "key" | "oauth" | "agent" | string;

  /**
   * Connection configuration for AI agents.
   * `provider`, `type`, and `endpoint` are required properties here,
   * but this section can accept additional via options.
   */
  model Connection {
    @doc("The Authentication type for the AI service (e.g., 'key' for API key, 'oauth' for OAuth tokens)")
    @sample(#{ authType: "key" })
    authType: ConnectionType;

    @doc("The endpoint URL for the AI service")
    @sample(#{ endpoint: "https://{your-custom-endpoint}.openai.azure.com/" })
    endpoint: string;

    @doc("Additional options for the connection")
    options?: Record<unknown> = #{};
  }
}
