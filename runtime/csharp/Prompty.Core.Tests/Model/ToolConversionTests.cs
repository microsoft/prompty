using Xunit;
using System.Text.Json;
using Prompty.Core;


#pragma warning disable IDE0130
namespace Prompty.Core.Tests.Model;
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
        Assert.Equal(instance.name, "my-tool");
        Assert.Equal(instance.kind, "function");
        Assert.Equal(instance.description, "A description of the tool");
    }
}