import "./core.tsp";

namespace Prompty.Core {
  /**
   * Connection configuration for AI agents.
   * `provider`, `type`, and `endpoint` are required properties here,
   * but this section can accept additional via options.
   */
  model Connection {
    @doc("The unique provider of the connection")
    provider: string;

    @doc("The type of connection used to tell the runtime how to load and execute the agent")
    type: string;

    @doc("The endpoint URL for the connection")
    endpoint: string;

    @doc("Additional options for model execution")
    options?: Record<unknown> = #{};
  }

  /**
   * Model for defining the structure and behavior of AI agents.
   * Yaml Example:
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * model:
   *   id: gpt-35-turbo
   *   connection:
   *     provider: azure
   *     type: chat
   *     endpoint: https://{your-custom-endpoint}.openai.azure.com/
   * ```
   *
   * A shorthand representation of the model configuration can also be constructed as
   * follows:
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * model: gpt-35-turbo
   * ```
   * This will be expanded as follows:
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * model:
   *   id: gpt-35-turbo
   * ```
   */
  model Model {
    @doc("The unique identifier of the model")
    id: string = "";

    @doc("The connection configuration for the model")
    connection?: Connection;
  }
}
