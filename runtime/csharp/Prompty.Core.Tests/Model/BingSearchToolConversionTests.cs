using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class BingSearchToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: bing_search
        connection:
          kind: provider-connection
        configurations:
          - connectionId: connectionId
            instanceName: MyBingInstance
            market: en-US
            setLang: en
            count: 10
            freshness: Day
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "bing_search",
          "connection": {
            "kind": "provider-connection"
          },
          "configurations": [
            {
              "connectionId": "connectionId",
              "instanceName": "MyBingInstance",
              "market": "en-US",
              "setLang": "en",
              "count": 10,
              "freshness": "Day"
            }
          ]
        }
        """;

        var instance = JsonSerializer.Deserialize<BingSearchTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "bing_search");
    }
}