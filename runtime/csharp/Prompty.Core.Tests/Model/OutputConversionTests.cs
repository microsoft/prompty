using Xunit;
using System.Text.Json;

#pragma warning disable IDE0130
namespace Prompty.Core;
#pragma warning restore IDE0130


public class OutputConversionTests
{
    [Fact]
    public void LoadYamlInput()
    {
        string yamlData = """
        name: my-output
        kind: string
        description: A description of the output property
        required: true
        
        """;
        Assert.Equal(typeof(string), yamlData.GetType());
    }

    [Fact]
    public void LoadJsonInput()
    {
        string jsonData = """
        {
          "name": "my-output",
          "kind": "string",
          "description": "A description of the output property",
          "required": true
        }
        """;

        var instance = JsonSerializer.Deserialize<Output>(jsonData);
        Assert.NotNull(instance);
        Assert.Equal("my-output", instance.Name);
        Assert.Equal("string", instance.Kind);
        Assert.Equal("A description of the output property", instance.Description);
        Assert.True(instance.Required);
    }
}