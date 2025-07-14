namespace Prompty {
  model Prop {
    @doc("The data type of the property")
    type: "string" | "number" | "array" | "object" | "boolean" = "string";

    @doc("A short description of the property")
    description?: string = "";
  }

  model Property {
    @doc("The name of the property")
    name: string = "";

    ...Prop;
  }

  model Input {
    ...Property;

    @doc("Whether the input parameter is required")
    required?: boolean = false;

    @doc("Whether the input can emit structural text when parsing output")
    strict?: boolean = false;

    @doc("The default value of the input")
    default?: unknown = null;

    @doc("A sample value of the input for examples and tooling")
    sample?: unknown = null;
  }

  @discriminator("type")
  model OutputProperty {
    @doc("The name of the output property")
    name: string = "";

    @doc("The data type of the output property")
    type: "string" | "number" | "boolean" | "array" | "object" = "string";

    @doc("A short description of the output property")
    description?: string = "";

    @doc("Whether the output property is required")
    required?: boolean = true;
  }

  model ArrayOutput extends OutputProperty {
    type: "array";

    @doc("The type of items contained in the array")
    items: OutputProperty;
  }

  model ObjectOutput extends OutputProperty {
    type: "object";

    @doc("The properties contained in the object")
    properties: OutputProperty[] | Record<OutputProperty> = #[];
  }

  union Output {
    @doc("Simple output property with a specific type")
    output: OutputProperty,

    @doc("Array output containing multiple items of a specific type")
    array: ArrayOutput,

    @doc("Object output containing multiple named properties")
    object: ObjectOutput,
  }

  model Connection {
    @doc("The type of connection used to tell the runtime how to load and execute the agent")
    type: string;

    ...Record<unknown>;
  }

  model Model {
    @doc("The unique identifier of the model")
    id?: string = "";

    @doc("The API used by the agent (e.g., chat, completion)")
    api: string = "";

    @doc("The connection configuration for the model")
    connection: Connection;

    @doc("Additional options for model execution")
    options?: Record<unknown> = #{};
  }

  model Template {
    @doc("Template rendering engine used for slot filling prompts (e.g., mustache, jinja2)")
    format: string;

    @doc("Parser used to process the rendered template into API-compatible format")
    parser: string;

    @doc("Whether the template can emit structural text for parsing output")
    strict?: boolean = false;

    @doc("Additional options for the template engine")
    options?: Record<unknown> = #{};
  }

  model ToolParameter {
    ...Property;

    @doc("Whether the tool parameter is required")
    required?: boolean = true;

    @doc("Allowed enumeration values for the parameter")
    `enum`?: unknown[] = #[];
  }

  model FunctionTool {
    @doc("The type identifier for function tools")
    type: "function";

    @doc("A short description of the function tool for metadata purposes")
    description?: string = "";

    @doc("Parameters accepted by the function tool")
    parameters: ToolParameter[] | Record<ToolParameter> = #[];
  }

  model ServerTool {
    @doc("The name of the server tool")
    name?: string;

    @doc("The type identifier for server tools")
    type: string;

    @doc("A short description of the server tool for metadata purposes")
    description?: string = "";

    @doc("Configuration options for the server tool")
    options: Record<unknown> = #{};
  }

  union Tool {
    @doc("Function-based tool for local execution")
    function: FunctionTool,

    @doc("Server-based tool for remote execution")
    server: ServerTool,
  }

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
    inputs: Input[] | Record<Input> = #[];

    @doc("Expected output format and structure from the agent")
    outputs?: Output[] | Record<Output> = #[];

    // tools
    @doc("Tools available to the agent for extended functionality")
    tools?: Tool[] | Record<Tool> = #[];

    // template values
    @doc("Template configuration for prompt rendering")
    template?: Template;

    @doc("Give your agent clear directions on what to do and how to do it. Include specific tasks, their order, and any special instructions like tone or engagement style. (can use this for a pure yaml declaration or as content in the markdown format)")
    instructions?: string = "";

    @doc("Additional instructions or context for the agent, can be used to provide extra guidance (can use this for a pure yaml declaration)")
    additional_instructions?: string = "";
  }
}
