import "./core.tsp";

namespace Prompty.Core {
  model Connection {
    @doc("The type of connection used to tell the runtime how to load and execute the agent")
    type: string;

    ...Options;
  }

  model Model {
    @doc("The unique identifier of the model")
    id?: string = "";

    @doc("The API used by the agent (e.g., chat, completion)")
    api: string = "";

    @doc("The connection configuration for the model")
    connection: Connection;

    @doc("Additional options for model execution")
    options?: Options = #{};
  }
}
