import "@prompty/emitter";
import "./core.tsp";
import "./tools";

namespace Prompty.Core {
  /**
   * Represents a binding between an input property and a tool parameter.
   */
  model Binding {
    @doc("The input property that will be bound to the tool parameter argument")
    input: string;
  }

  alias Bindings = Record<Binding> | Named<Binding, "Name of the binding">[];

  /**
   * Represents a parameter for a tool.
   */
  @discriminator("kind")
  model Parameter {
    @doc("The data type of the tool parameter")
    @sample(#{ kind: "string" })
    kind: string;

    @doc("A short description of the property")
    @sample(#{ description: "A description of the tool parameter" })
    description?: string = "";

    @doc("Whether the tool parameter is required")
    @sample(#{ required: true })
    required?: boolean = true;

    @doc("Allowed enumeration values for the parameter")
    @sample(#{ `enum`: #["value1", "value2", "value3"] })
    `enum`?: unknown[] = #[];
  }

  /**
   * Represents an object parameter for a tool.
   */
  model ObjectParameter extends Parameter {
    kind: "object";

    @doc("The properties of the object parameter")
    @sample(#{
      properties: #{ param1: #{ kind: "string" }, param2: #{ kind: "number" } },
    })
    properties: Parameters = #[];
  }

  /**
   * Represents an array parameter for a tool.
   */
  model ArrayParameter extends Parameter {
    kind: "array";

    @doc("The kind of items contained in the array")
    @sample(#{ items: #{ kind: "string" } })
    items: Parameter | Named<Parameter>;
  }

  alias Parameters = Record<Parameter> | Named<
    Parameter,
    "Name of the parameter"
  >[];

  union ToolTypes {
    functionType: "function",
    string,
  }

  /**
   * Represents a tool that can be used in prompts.
   */
  @abstract
  @discriminator("kind")
  model Tool {
    @doc("The kind identifier for the tool")
    @sample(#{ kind: "function" })
    kind: ToolTypes;

    @doc("A short description of the tool for metadata purposes")
    @sample(#{ description: "A description of the tool" })
    description?: string = "";

    @doc("Tool argument bindings to input properties")
    @sample(#{ bindings: #{ input: "value" } })
    bindings?: Bindings = #[];
  }

  /**
   * Represents a local function tool.
   */
  model FunctionTool extends Tool {
    @doc("The kind identifier for function tools")
    kind: "function";

    @doc("Parameters accepted by the function tool")
    @sample(#{
      parameters: #{ param1: #{ kind: "string" }, param2: #{ kind: "number" } },
    })
    parameters: Parameters = #[];
  }

  /**
   * Represents a generic server tool that runs on a server
   * This tool kind is designed for operations that require server-side execution
   * It may include features such as authentication, data storage, and long-running processes
   * This tool kind is ideal for tasks that involve complex computations or access to secure resources
   * Server tools can be used to offload heavy processing from client applications
   */
  model ServerTool extends Tool {
    @doc("The kind identifier for server tools")
    kind: "*";

    @doc("Connection configuration for the server tool")
    @sample(#{
      connection: #{
        provider: "key",
        endpoint: "https://api.yourservice.com/",
        apiKey: "your-api-key",
      },
    })
    connection: Connection;

    @doc("Configuration options for the server tool")
    @sample(#{ options: #{ timeout: 30, retries: 3 } })
    options: Record<unknown> = #{};
  }

  alias Tools = Record<Tool> | Named<Tool>[];
}
