using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class ToolConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-tool
        kind: function
        description: A description of the tool
        bindings:
          input: value
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-tool",
          "kind": "function",
          "description": "A description of the tool",
          "bindings": {
            "input": "value"
          }
        }
        """;

        var instance = JsonSerializer.Deserialize<Tool>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-tool", instance.Name);
        Assert.Equal("function", instance.Kind);
        Assert.Equal("A description of the tool", instance.Description);
    }
}