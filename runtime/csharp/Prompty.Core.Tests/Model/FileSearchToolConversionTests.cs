using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
#pragma warning restore IDE0130


public class FileSearchToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: file_search
        connection:
          kind: provider-connection
        maxNumResults: 10
        ranker: default
        scoreThreshold: 0.5
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "file_search",
          "connection": {
            "kind": "provider-connection"
          },
          "maxNumResults": 10,
          "ranker": "default",
          "scoreThreshold": 0.5
        }
        """;

        var instance = JsonSerializer.Deserialize<FileSearchTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal(instance.kind, "file_search");
        Assert.Equal(instance.maxNumResults, 10);
        Assert.Equal(instance.ranker, "default");
        Assert.Equal(instance.scoreThreshold, 0.5);
    }
}