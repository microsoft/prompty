import "@prompty/emitter";
import "./core.tsp";
import "./metadata.tsp";
import "./model.tsp";
import "./inputs.tsp";
import "./outputs.tsp";
import "./tools.tsp";
import "./template.tsp";

namespace Prompty.Core {
  /**
   * Prompty is a specification for defining AI agents with structured metadata, inputs, outputs, tools, and templates.
   * It provides a way to create reusable and composable AI agents that can be executed with specific configurations.
   * The specification includes metadata about the agent, model configuration, input parameters, expected outputs,
   * available tools, and template configurations for prompt rendering.
   *
   * These can be written in a markdown format or in a pure YAML format.
   *
   * ## Markdown Example
   *
   * ```markdown
   * ---
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * metadata:
   *   authors:
   *     - sethjuarez
   *     - jietong
   *
   * model:
   *  id: gpt-35-turbo
   *  connection:
   *    provider: azure
   *    type: chat
   *    endpoint: https://{your-custom-endpoint}.openai.azure.com/
   *
   * inputs:
   *   firstName:
   *     type: string
   *     description: The first name of the customer.
   *     sample: Jane
   *     default: Jane
   *     required: true
   *   lastName: Doe
   *   question: What is the meaning of life?
   *
   * template:
   *   format: jinja2
   *   parser: prompty
   * ---
   * system:
   * You are an AI assistant who helps people find information.
   * As the assistant, you answer questions briefly, succinctly,
   * and in a personable manner using markdown and even add some personal flair with appropriate emojis.
   *
   * # Customer
   * You are helping {{firstName}} {{lastName}} to find answers to their questions.
   * Use their name to address them in your responses.
   *
   * user:
   * {{question}}
   * ```
   *
   * ## Yaml Example
   *
   * ```yaml
   * name: Basic Prompt
   * description: A basic prompt that uses the GPT-3 chat API to answer questions
   * metadata:
   *   authors:
   *     - sethjuarez
   *     - jietong
   *
   * model:
   *  id: gpt-35-turbo
   *  connection:
   *    provider: azure
   *    type: chat
   *    endpoint: https://{your-custom-endpoint}.openai.azure.com/
   *
   * inputs:
   *   firstName:
   *     type: string
   *     description: The first name of the customer.
   *     sample: Jane
   *     default: Jane
   *     required: true
   *   lastName: Doe
   *   question: What is the meaning of life?
   *
   * template:
   *   format: jinja2
   *   parser: prompty
   *
   * instructions: |
   *   system:
   *   You are an AI assistant who helps people find information.
   *   As the assistant, you answer questions briefly, succinctly,
   *   and in a personable manner using markdown and even add some personal flair with appropriate emojis.
   *
   *   # Customer
   *   You are helping {{firstName}} {{lastName}} to find answers to their questions.
   *   Use their name to address them in your responses.
   *
   *   user:
   *   {{question}}
   * ```
   */
  model Prompty {
    // Prompty metadata
    @doc("Type represented by the Prompty document")
    type: string = "";

    @doc("Unique identifier for the Prompty document")
    id?: string = "";

    @doc("Version of the Prompty specification")
    version?: string = "";

    @doc("Human-readable name of the agent")
    name: string = "";

    @doc("Description of the agent's capabilities and purpose")
    description?: string = "";

    @doc("Additional metadata including authors, tags, and other arbitrary properties")
    metadata?: Metadata = #{};

    // model execution
    @doc("Model configuration used for execution")
    `model`: Model | string;

    // Inputs and Outputs
    @doc("Input parameters that participate in template rendering")
    inputs?: Inputs = #[];

    @doc("Expected output format and structure from the agent")
    outputs?: Outputs = #[];

    // tools
    @doc("Tools available to the agent for extended functionality")
    tools?: Tools = #[];

    // template values
    @doc("Template configuration for prompt rendering")
    template?: Template;

    @doc("Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)")
    instructions?: string = "";

    @doc("Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)")
    additional_instructions?: string = "";
  }
}
