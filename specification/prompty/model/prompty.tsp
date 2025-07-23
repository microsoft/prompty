import "./core.tsp";
import "./model.tsp";
import "./inputs.tsp";
import "./outputs.tsp";
import "./tools.tsp";
import "./template.tsp";

namespace Prompty.Core {
  model Prompty {
    // Prompty metadata
    @doc("Unique identifier for the Prompty document")
    id?: string = "";

    @doc("Version of the Prompty specification")
    version?: string = "";

    @doc("Human-readable name of the agent")
    name: string = "";

    @doc("Description of the agent's capabilities and purpose")
    description?: string = "";

    @doc("Additional metadata including authors, tags, and other arbitrary properties")
    metadata?: Record<unknown> = #{};

    // model execution
    @doc("Model configuration used for execution")
    `model`: Model;

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
