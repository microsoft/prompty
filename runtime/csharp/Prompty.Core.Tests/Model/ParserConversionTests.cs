using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ParserConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: prompty
        options:
          key: value
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "prompty",
          "options": {
            "key": "value"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Parser>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("prompty", instance.Kind);
    }
    [Fact]
    public void LoadFromString()
    {
        var data = "\"example\"";
        var instance = JsonSerializer.Deserialize<Parser>(data);
        Assert.NotNull(instance);
        Assert.Equal("example", instance.Kind);
    }

}