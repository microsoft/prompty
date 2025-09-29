using Xunit;
using System.Text.Json;
using YamlDotNet.Serialization;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class FunctionToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        kind: function
        parameters:
          param1:
            kind: string
          param2:
            kind: number
        
        """;


        var serializer = new DeserializerBuilder().Build();
        var instance = serializer.Deserialize<FunctionTool>(yamlData);

        Assert.NotNull(instance);
        Assert.Equal("function", instance.Kind);
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "kind": "function",
          "parameters": {
            "param1": {
              "kind": "string"
            },
            "param2": {
              "kind": "number"
            }
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<FunctionTool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("function", instance.Kind);
    }
}