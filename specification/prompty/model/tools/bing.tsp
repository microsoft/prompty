import "../core.tsp";
import "../tools.tsp";
import "../connection.tsp";

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
   * The Bing search tool.
   */
  model BingSearchTool extends Tool {
    @doc("The kind identifier for Bing search tools")
    @sample(#{ kind: "bing_search" })
    kind: "bing_search";

    @doc("The connection configuration for the Bing search tool")
    @sample(#{
      connection: #{ id: "connectionId" },
    })
    connection: Connection;

    @doc("The configuration options for the Bing search tool")
    @sample(#{
      configurations: #[
        #{ 
          connectionId: "connectionId",
          instanceName: "MyBingInstance",
          market: "en-US",
          setLang: "en",
          count: 10,
          freshness: "Day"
        }
      ]
    })
    configurations: BingSearchConfiguration[];
  }
}
