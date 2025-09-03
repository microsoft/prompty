import "../core.tsp";
import "../tools.tsp";

namespace Prompty.Core {
  /**
   * Configuration options for the Bing search tool.
   */
  model BingSearchConfiguration {
    @doc("Connection id for grounding with bing search")
    connectionId: string;

    @doc("The instance name of the Bing search tool, used to identify the specific instance in the system")
    instanceName: string;

    @doc("The market where the results come from.")
    market?: string;

    @doc("The language to use for user interface strings when calling Bing API.")
    setLang?: string;

    @doc("The number of search results to return in the bing api response")
    count?: int64;

    @doc("Filter search results by a specific time range. Accepted values: https://learn.microsoft.com/bing/search-apis/bing-web-search/reference/query-parameters")
    freshness?: string;
  }

  /**
   * Options for the Bing search tool.
   */
  model BingSearchOptions {
    @doc("The configuration options for the Bing search tool")
    configurations: BingSearchConfiguration[];
  }

  /**
   * The Bing search tool.
   */
  model BingSearchTool extends Tool {
    @doc("The type identifier for Bing search tools")
    type: "bing_search";

    @doc("The options for the Bing search tool")
    options: BingSearchOptions;
  }
}
