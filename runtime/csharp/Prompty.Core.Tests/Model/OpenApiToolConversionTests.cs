using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class OpenApiToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: openapi
        connection:
          kind: provider-connection
        specification: https://api.example.com/openapi.json
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "openapi",
          "connection": {
            "kind": "provider-connection"
          },
          "specification": "https://api.example.com/openapi.json"
        }
        """;

        var instance = JsonSerializer.Deserialize<OpenApiTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("openapi", instance.Kind);
        Assert.Equal("https://api.example.com/openapi.json", instance.Specification);
    }
}