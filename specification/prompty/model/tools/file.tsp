import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

namespace Prompty.Core {
  /**
   * Options for ranking file search results.
   */
  model FileSearchRankingOptions {
    @doc("File search ranker.")
    ranker: string;

    @doc("Ranker search threshold.")
    scoreThreshold: float32;
  }

  /**
   * Options for file search.
   */
  model FileSearchOptions {
    @doc("The maximum number of search results to return.")
    maxNumResults?: int32;

    @doc("Options for ranking file search results.")
    rankingOptions?: FileSearchRankingOptions;
  }

  /**
   * A tool for searching files.
   * This tool allows an AI agent to search for files based on a query.
   */
  model FileSearchTool extends Tool {
    @doc("The type identifier for file search tools")
    type: "file_search";

    @doc("The connection configuration for the file search tool")
    connection: Connection;

    @doc("The options for the file search tool")
    options: FileSearchOptions;
  }
}
