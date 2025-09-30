using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
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

        var instance = YamlSerializer.Deserialize<FileSearchTool>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("file_search", instance.Kind);
        Assert.Equal(10, instance.MaxNumResults);
        Assert.Equal("default", instance.Ranker);
        Assert.Equal(0.5, instance.ScoreThreshold);
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
        Assert.Equal("file_search", instance.Kind);
        Assert.Equal(10, instance.MaxNumResults);
        Assert.Equal("default", instance.Ranker);
        Assert.Equal(0.5, instance.ScoreThreshold);
    }
}