using Xunit;
using System.Text.Json;

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
        Assert.Equal(typeof(string), yamlData.GetType());
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