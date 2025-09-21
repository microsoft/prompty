import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace Prompty.Core {
  /**
   * A tool for searching files.
   * This tool allows an AI agent to search for files based on a query.
   */
  model FileSearchTool extends Tool {
    @doc("The kind identifier for file search tools")
    @sample(#{ kind: "file_search" })
    kind: "file_search";

    @doc("The connection configuration for the file search tool")
    @sample(#{
      connection: #{ kind: "provider-connection" },
    })
    connection: Connection;

    @doc("The maximum number of search results to return.")
    @sample(#{ maxNumResults: 10 })
    maxNumResults?: int32;

    @doc("File search ranker.")
    @sample(#{ ranker: "default" })
    ranker: string;

    @doc("Ranker search threshold.")
    @sample(#{ scoreThreshold: 0.5 })
    scoreThreshold: float32;
  }
}
